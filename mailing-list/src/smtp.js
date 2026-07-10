'use strict';

const fs = require('fs');
const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const config = require('./config');
const db = require('./db');
const mailer = require('./mailer');
const templates = require('./templates');
const { checkInboundAuth } = require('./authcheck');
const { RateLimiter } = require('./ratelimit');

const HOUR = 60 * 60 * 1000;
const ipLimiter = new RateLimiter(HOUR);
const listPostLimiter = new RateLimiter(HOUR);
const signupLimiter = new RateLimiter(HOUR);
const signoutLimiter = new RateLimiter(HOUR);

function listFrom() {
  return `"${config.listName}" <${config.fromAddress}>`;
}

function sanitizeHeaderValue(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function stripHtml(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rejectionError(message, responseCode) {
  return Object.assign(new Error(message), { responseCode });
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function handleSubscribeRequest(email) {
  const { subscriber, alreadyConfirmed } = db.createPending(email, 'email');
  if (alreadyConfirmed) {
    await mailer.sendMail(
      Object.assign({ from: listFrom(), to: email }, templates.alreadySubscribedMail())
    );
    return;
  }
  const confirmUrl = `${config.publicBaseUrl}/confirm?token=${subscriber.confirmToken}`;
  await mailer.sendMail(
    Object.assign({ from: listFrom(), to: email }, templates.confirmSubscriptionMail(confirmUrl))
  );
}

async function handleUnsubscribeRequest(email) {
  const removed = db.removeByEmail(email);
  const mail = removed ? templates.unsubscribedMail() : templates.notSubscribedMail();
  await mailer.sendMail(Object.assign({ from: listFrom(), to: email }, mail));
}

async function relayToList(parsed, fromAddr) {
  const subscribers = db.listConfirmed();
  if (subscribers.length === 0) return;

  const fromName = sanitizeHeaderValue(
    (parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].name) ||
      fromAddr
  );
  const tag = config.listAddress.split('@')[0];
  const subjectBase = sanitizeHeaderValue(parsed.subject || '(kein Betreff)');
  const subject = subjectBase.toLowerCase().startsWith(`[${tag}]`)
    ? subjectBase
    : `[${tag}] ${subjectBase}`;
  const bodyText = parsed.text || (parsed.html ? stripHtml(parsed.html) : '');
  const listIdHeader = `${config.listName} <${config.listAddress.replace('@', '.')}>`;

  const CONCURRENCY = 10;
  for (let i = 0; i < subscribers.length; i += CONCURRENCY) {
    const batch = subscribers.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map((sub) => {
        const unsubscribeUrl = `${config.publicBaseUrl}/unsubscribe?token=${sub.unsubscribeToken}`;
        return mailer
          .sendMail({
            from: `"${fromName} via ${config.listName}" <${config.fromAddress}>`,
            replyTo: fromAddr,
            to: sub.email,
            subject,
            text: bodyText + templates.listFooterText(unsubscribeUrl),
            headers: {
              'List-Id': listIdHeader,
              'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:${config.signoutAddress}>`,
              'List-Post': `<mailto:${config.listAddress}>`,
            },
          })
          .catch((err) => console.error(`[smtp] failed to relay to ${sub.email}:`, err.message));
      })
    );
  }
}

async function processMessage(raw, parsed, session) {
  // Loop guard: never re-broadcast mail that already carries our own
  // list header (e.g. bounces of relayed posts, or misconfigured
  // forwarding loops).
  if (parsed.headers.get(config.loopHeader)) {
    console.log('[smtp] dropping message that already passed through the list (loop guard)');
    return;
  }

  const fromAddr = (
    (parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address) ||
    (session.envelope.mailFrom && session.envelope.mailFrom.address) ||
    ''
  ).toLowerCase();

  if (!fromAddr) {
    console.log('[smtp] message with no usable From address, dropping');
    return;
  }

  const rcptAddrs = (session.envelope.rcptTo || []).map((r) => r.address.toLowerCase());

  // Dedicated signup/signout addresses: any mail sent to anmeldung@htl.ing
  // or abmeldung@htl.ing is a subscribe/unsubscribe request, regardless
  // of subject.
  if (rcptAddrs.includes(config.signupAddress)) {
    return handleSubscribeRequest(fromAddr);
  }

  if (rcptAddrs.includes(config.signoutAddress)) {
    return handleUnsubscribeRequest(fromAddr);
  }

  if (rcptAddrs.includes(config.listAddress)) {
    // onRcptTo already rejected non-subscribers before DATA was
    // transferred; this is a defence-in-depth re-check plus the
    // SPF/DKIM/DMARC authentication of the actual message content,
    // which can only happen once we have the full raw message.
    const subscriber = db.getSubscriber(fromAddr);
    if (!subscriber || subscriber.status !== 'confirmed') {
      console.log(`[smtp] dropping list post from no-longer-subscribed ${fromAddr}`);
      return;
    }

    const auth = await checkInboundAuth(raw, session, fromAddr);
    console.log(
      `[smtp] auth check for ${fromAddr}: spf=${auth.spfResult} dkim=${auth.dkimResult} ` +
        `dmarc=${auth.dmarcResult}/${auth.dmarcPolicy}`
    );
    if (auth.reject) {
      throw rejectionError(
        `Message rejected: DMARC failure for sender domain (policy=reject)`,
        550
      );
    }

    return relayToList(parsed, fromAddr);
  }

  // Any other accepted recipient (postmaster@) — nothing to relay, just log.
  console.log(`[smtp] received mail for ${rcptAddrs.join(', ')} from ${fromAddr}; no list action`);
}

function onData(stream, session, callback) {
  streamToBuffer(stream)
    .then(async (raw) => {
      if (stream.sizeExceeded) {
        throw rejectionError('Message too large', 552);
      }
      const parsed = await simpleParser(raw);
      await processMessage(raw, parsed, session);
      callback();
    })
    .catch((err) => {
      if (err && err.responseCode) {
        console.log(`[smtp] rejecting message: ${err.message}`);
        return callback(err);
      }
      console.error('[smtp] error processing inbound message:', err);
      // Accept anyway — a 4xx/5xx here just causes the sender's MTA to
      // retry/bounce, which won't fix a parsing bug on our side.
      callback();
    });
}

function onMailFrom(address, session, callback) {
  const ip = session.remoteAddress || 'unknown';
  if (!ipLimiter.allow(ip, config.rateLimits.connectionsPerIpPerHour)) {
    return callback(rejectionError('Too many messages from this connection, try again later', 450));
  }
  callback();
}

function onRcptTo(address, session, callback) {
  const rcpt = address.address.toLowerCase();
  const mailFrom = (
    (session.envelope.mailFrom && session.envelope.mailFrom.address) ||
    ''
  ).toLowerCase();

  if (rcpt === config.signupAddress) {
    if (!signupLimiter.allow(mailFrom || 'unknown', config.rateLimits.signupPerTargetPerHour)) {
      return callback(
        rejectionError('Too many signup requests for this address, try again later', 450)
      );
    }
    return callback();
  }

  if (rcpt === config.signoutAddress) {
    if (!signoutLimiter.allow(mailFrom || 'unknown', config.rateLimits.signoutPerTargetPerHour)) {
      return callback(
        rejectionError('Too many signout requests for this address, try again later', 450)
      );
    }
    return callback();
  }

  if (rcpt === `postmaster@${config.domain}`) {
    return callback();
  }

  if (rcpt === config.listAddress) {
    const subscriber = mailFrom && db.getSubscriber(mailFrom);
    if (!subscriber || subscriber.status !== 'confirmed') {
      return callback(
        rejectionError(
          `Only list members may post. Join at ${config.signupAddress} or https://htl.ing/`,
          550
        )
      );
    }
    if (!listPostLimiter.allow(mailFrom, config.rateLimits.listPostPerSenderPerHour)) {
      return callback(rejectionError('Too many messages, try again later', 450));
    }
    return callback();
  }

  return callback(rejectionError('No such mailbox here', 550));
}

function createSmtpServer() {
  const options = {
    banner: `${config.domain} ESMTP`,
    size: 15 * 1024 * 1024, // 15 MB
    disabledCommands: ['AUTH'],
    onMailFrom,
    onRcptTo,
    onData,
    logger: false,
  };

  if (config.smtp.tlsKeyPath && config.smtp.tlsCertPath) {
    options.key = fs.readFileSync(config.smtp.tlsKeyPath);
    options.cert = fs.readFileSync(config.smtp.tlsCertPath);
  }

  return new SMTPServer(options);
}

module.exports = { createSmtpServer };
