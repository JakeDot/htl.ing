'use strict';

const config = require('./config');
const { createSmtpServer } = require('./smtp');
const { createApp } = require('./web');

const smtpServer = createSmtpServer();
smtpServer.on('error', (err) => console.error('[smtp] server error:', err));
smtpServer.listen(config.smtp.port, config.smtp.host, () => {
  console.log(`[smtp] listening on ${config.smtp.host}:${config.smtp.port} for ${config.listAddress}`);
});

const app = createApp();
const httpServer = app.listen(config.http.port, config.http.host, () => {
  console.log(`[http] listening on ${config.http.host}:${config.http.port}`);
});

function shutdown(signal) {
  console.log(`[index] received ${signal}, shutting down...`);
  smtpServer.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
