'use strict';

require('dotenv').config();
const path = require('path');

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const config = {
  domain: process.env.DOMAIN || 'htl.ing',
  listAddress: (process.env.LIST_ADDRESS || 'ing@htl.ing').toLowerCase(),
  signupAddress: (process.env.SIGNUP_ADDRESS || 'anmeldung@htl.ing').toLowerCase(),
  signoutAddress: (process.env.SIGNOUT_ADDRESS || 'abmeldung@htl.ing').toLowerCase(),
  listName: process.env.LIST_NAME || 'htl.ing Mailingliste',
  fromAddress: process.env.FROM_ADDRESS || process.env.LIST_ADDRESS || 'ing@htl.ing',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'https://list.htl.ing').replace(/\/+$/, ''),

  smtp: {
    host: process.env.SMTP_HOST || '0.0.0.0',
    port: parseInt(process.env.SMTP_PORT || '25', 10),
    tlsKeyPath: process.env.SMTP_TLS_KEY_PATH || null,
    tlsCertPath: process.env.SMTP_TLS_CERT_PATH || null,
  },

  http: {
    host: process.env.HTTP_HOST || '127.0.0.1',
    port: parseInt(process.env.HTTP_PORT || '3000', 10),
    corsOrigins: (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  outbound: {
    host: process.env.OUTBOUND_SMTP_HOST || '127.0.0.1',
    port: parseInt(process.env.OUTBOUND_SMTP_PORT || '587', 10),
    secure: bool(process.env.OUTBOUND_SMTP_SECURE, false),
    user: process.env.OUTBOUND_SMTP_USER || null,
    pass: process.env.OUTBOUND_SMTP_PASS || null,
  },

  dkim: {
    domainName: process.env.DKIM_DOMAIN || null,
    keySelector: process.env.DKIM_SELECTOR || null,
    privateKeyPath: process.env.DKIM_PRIVATE_KEY_PATH || null,
  },

  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')),
  adminEmail: process.env.ADMIN_EMAIL || `postmaster@${process.env.DOMAIN || 'htl.ing'}`,

  // Header used to mark mail that already passed through the list, to
  // prevent re-broadcast loops and to recognise our own automated mail.
  loopHeader: 'x-htling-list',

  // Reject inbound list posts that fail DMARC against a sending domain's
  // own p=reject policy (protects list members from spoofed "from" a
  // subscriber's address). Fails open on DNS/lookup errors and on
  // p=none/p=quarantine policies.
  dmarcEnforce: bool(process.env.DMARC_ENFORCE, true),

  // Inbound abuse limits (sliding window, in-memory). Keeps a compromised
  // or malicious sender from flooding the list, and stops "subscription
  // bombing" (repeatedly triggering confirmation mail to a third party).
  rateLimits: {
    listPostPerSenderPerHour: parseInt(process.env.RATE_LIMIT_LIST_POST || '40', 10),
    signupPerTargetPerHour: parseInt(process.env.RATE_LIMIT_SIGNUP || '3', 10),
    signoutPerTargetPerHour: parseInt(process.env.RATE_LIMIT_SIGNOUT || '5', 10),
    connectionsPerIpPerHour: parseInt(process.env.RATE_LIMIT_IP || '120', 10),
  },
};

module.exports = config;
