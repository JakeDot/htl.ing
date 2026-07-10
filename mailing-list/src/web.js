'use strict';

const path = require('path');
const express = require('express');
const config = require('./config');
const db = require('./db');
const mailer = require('./mailer');
const templates = require('./templates');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Minimal in-memory rate limiter: N requests per window per IP.
// Good enough for a small list's signup form; the process restarts
// clear it, which is an acceptable trade-off here.
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const timestamps = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (timestamps.length >= max) {
      return res.status(429).json({ ok: false, error: 'Zu viele Anfragen, bitte später erneut versuchen.' });
    }
    timestamps.push(now);
    hits.set(ip, timestamps);
    next();
  };
}

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (origin && config.http.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

function page({ title, heading, message, ok }) {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>
  body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#f9f9f9;color:#2c3e50;
       display:flex;min-height:100vh;align-items:center;justify-content:center;padding:1.5rem;margin:0}
  .box{max-width:480px;background:#fff;border:1px solid #dee2e6;border-radius:8px;padding:2rem;
       box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center}
  h1{font-size:1.4rem;margin:0 0 1rem;color:${ok ? '#2c3e50' : '#c0392b'}}
  a{color:#c0392b}
</style>
</head>
<body>
  <div class="box">
    <h1>${heading}</h1>
    <p>${message}</p>
    <p><a href="https://htl.ing/">&larr; Zurück zu htl.ing</a></p>
  </div>
</body>
</html>`;
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '10kb' }));
  app.use(corsMiddleware);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.post('/api/subscribe', rateLimiter({ windowMs: 15 * 60 * 1000, max: 5 }), async (req, res) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ ok: false, error: 'Bitte eine gültige E-Mail-Adresse angeben.' });
    }
    try {
      const { subscriber, alreadyConfirmed } = db.createPending(email, 'web');
      if (alreadyConfirmed) {
        await mailer.sendMail(
          Object.assign(
            { from: `"${config.listName}" <${config.fromAddress}>`, to: email },
            templates.alreadySubscribedMail()
          )
        );
      } else {
        const confirmUrl = `${config.publicBaseUrl}/confirm?token=${subscriber.confirmToken}`;
        await mailer.sendMail(
          Object.assign(
            { from: `"${config.listName}" <${config.fromAddress}>`, to: email },
            templates.confirmSubscriptionMail(confirmUrl)
          )
        );
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('[web] /api/subscribe failed:', err);
      res.status(500).json({ ok: false, error: 'Interner Fehler, bitte später erneut versuchen.' });
    }
  });

  app.get('/confirm', async (req, res) => {
    const token = String(req.query.token || '');
    const subscriber = token && db.confirmByToken(token);
    if (!subscriber) {
      return res
        .status(400)
        .send(
          page({
            title: 'Anmeldung fehlgeschlagen',
            heading: 'Ungültiger oder abgelaufener Link',
            message: 'Dieser Bestätigungslink ist ungültig. Bitte melde dich erneut über das Formular an.',
            ok: false,
          })
        );
    }
    try {
      const unsubscribeUrl = `${config.publicBaseUrl}/unsubscribe?token=${subscriber.unsubscribeToken}`;
      await mailer.sendMail(
        Object.assign(
          { from: `"${config.listName}" <${config.fromAddress}>`, to: subscriber.email },
          templates.welcomeMail(unsubscribeUrl)
        )
      );
    } catch (err) {
      console.error('[web] failed to send welcome mail:', err);
    }
    res.send(
      page({
        title: 'Anmeldung bestätigt',
        heading: 'Willkommen!',
        message: `Deine Anmeldung bei ${config.listAddress} wurde bestätigt.`,
        ok: true,
      })
    );
  });

  app.get('/unsubscribe', async (req, res) => {
    const token = String(req.query.token || '');
    const email = token && db.unsubscribeByToken(token);
    if (!email) {
      return res
        .status(400)
        .send(
          page({
            title: 'Abmeldung fehlgeschlagen',
            heading: 'Ungültiger Link',
            message: 'Dieser Abmeldelink ist ungültig oder wurde bereits verwendet.',
            ok: false,
          })
        );
    }
    res.send(
      page({
        title: 'Abgemeldet',
        heading: 'Abmeldung erfolgreich',
        message: `${email} wurde von ${config.listAddress} abgemeldet.`,
        ok: true,
      })
    );
  });

  return app;
}

module.exports = { createApp };
