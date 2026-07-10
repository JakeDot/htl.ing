'use strict';

const { authenticate } = require('mailauth');
const config = require('./config');

/**
 * Runs SPF/DKIM/DMARC verification on a raw inbound message. Used to
 * decide whether a post to the list should be trusted before it's
 * relayed to every subscriber.
 *
 * Fails open (returns reject: false) on lookup errors, since a DNS
 * hiccup shouldn't silently drop legitimate list traffic.
 */
async function checkInboundAuth(raw, session, mailFromAddress) {
  try {
    const result = await authenticate(raw, {
      ip: session.remoteAddress,
      helo: session.hostNameAppearsAs || session.clientHostname || undefined,
      mailFrom: mailFromAddress ? { address: mailFromAddress } : false,
      sender: mailFromAddress || undefined,
    });

    const dmarcResult = result.dmarc && result.dmarc.status && result.dmarc.status.result;
    const dmarcPolicy = result.dmarc && result.dmarc.policy;
    const reject = Boolean(
      config.dmarcEnforce && dmarcResult === 'fail' && dmarcPolicy === 'reject'
    );

    return {
      ok: true,
      reject,
      spfResult: result.spf && result.spf.status && result.spf.status.result,
      dkimResult:
        result.dkim && result.dkim.results && result.dkim.results[0] && result.dkim.results[0].status
          ? result.dkim.results[0].status.result
          : 'none',
      dmarcResult,
      dmarcPolicy,
    };
  } catch (err) {
    console.error('[authcheck] verification failed, failing open:', err.message);
    return { ok: false, reject: false, error: err.message };
  }
}

module.exports = { checkInboundAuth };
