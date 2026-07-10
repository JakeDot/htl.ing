'use strict';

const fs = require('fs');
const nodemailer = require('nodemailer');
const config = require('./config');

const transportOptions = {
  host: config.outbound.host,
  port: config.outbound.port,
  secure: config.outbound.secure,
};

if (config.outbound.user && config.outbound.pass) {
  transportOptions.auth = {
    user: config.outbound.user,
    pass: config.outbound.pass,
  };
}

if (config.dkim.domainName && config.dkim.keySelector && config.dkim.privateKeyPath) {
  transportOptions.dkim = {
    domainName: config.dkim.domainName,
    keySelector: config.dkim.keySelector,
    privateKey: fs.readFileSync(config.dkim.privateKeyPath, 'utf8'),
  };
}

const transporter = nodemailer.createTransport(transportOptions);

/**
 * Send a system mail (confirmations, notices, relayed list posts).
 * Always tags outgoing mail with the loop-prevention header.
 */
async function sendMail(options) {
  const headers = Object.assign({}, options.headers, {
    [config.loopHeader]: config.listAddress,
    'Precedence': 'list',
    'Auto-Submitted': options.autoSubmitted || 'auto-generated',
  });
  return transporter.sendMail(Object.assign({}, options, { headers }));
}

module.exports = { sendMail, transporter };
