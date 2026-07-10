'use strict';

const fs = require('fs');
const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const config = require('./config');
const db = require('./db');
const mailer = require('./mailer');
const templates = require('./templates');

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

async function processMessage(parsed, session) {
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

  const autoSubmitted = parsed.headers.get('auto-submitted');
  const isAutomated = Boolean(autoSubmitted) && String(autoSubmitted).toLowerCase() !== 'no';

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

  const subscriber = db.getSubscriber(fromAddr);
  if (subscriber && subscriber.status === 'confirmed') {
    return relayToList(parsed, fromAddr);
  }

  // Non-subscriber posting to the list address: point them at how to
  // join, but never reply to automated mail.
  if (!isAutomated) {
    await mailer.sendMail(
      Object.assign({ from: listFrom(), to: fromAddr }, templates.howToSubscribeMail())
    );
  }
}

function onData(stream, session, callback) {
  simpleParser(stream)
    .then((parsed) => processMessage(parsed, session))
    .then(() => callback())
    .catch((err) => {
      console.error('[smtp] error processing inbound message:', err);
      // Accept anyway — a 4xx/5xx here just causes the sender's MTA to
      // retry/bounce, which won't fix a parsing bug on our side.
      callback();
    });
}

function onRcptTo(address, session, callback) {
  const rcpt = address.address.toLowerCase();
  const accepted = [
    config.listAddress,
    config.signupAddress,
    config.signoutAddress,
    `postmaster@${config.domain}`,
  ];
  if (accepted.includes(rcpt)) {
    return callback();
  }
  return callback(Object.assign(new Error('No such mailbox here'), { responseCode: 550 }));
}

function createSmtpServer() {
  const options = {
    banner: `${config.domain} ESMTP`,
    size: 15 * 1024 * 1024, // 15 MB
    disabledCommands: ['AUTH'],
    onMailFrom(address, session, callback) {
      callback();
    },
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
