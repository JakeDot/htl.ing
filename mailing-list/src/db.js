'use strict';

// Small JSON-file-backed subscriber store. All operations are
// synchronous — the list is small and this keeps read/modify/write
// cycles trivially race-free on Node's single-threaded event loop.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const FILE = path.join(config.dataDir, 'subscribers.json');

function ensureDataDir() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

function load() {
  ensureDataDir();
  if (!fs.existsSync(FILE)) return {};
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error(`[db] failed to read ${FILE}, starting empty:`, err.message);
    return {};
  }
}

function persist(subscribers) {
  ensureDataDir();
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(subscribers, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

let subscribers = load();

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function normalize(email) {
  return String(email || '').trim().toLowerCase();
}

function getSubscriber(email) {
  return subscribers[normalize(email)] || null;
}

function listConfirmed() {
  return Object.values(subscribers).filter((s) => s.status === 'confirmed');
}

/**
 * Register (or re-register) an email as pending confirmation.
 * Returns { subscriber, alreadyConfirmed }.
 */
function createPending(email, source) {
  const key = normalize(email);
  const existing = subscribers[key];
  if (existing && existing.status === 'confirmed') {
    return { subscriber: existing, alreadyConfirmed: true };
  }
  const subscriber = {
    email: key,
    status: 'pending',
    confirmToken: newToken(),
    unsubscribeToken: existing ? existing.unsubscribeToken : newToken(),
    source,
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    confirmedAt: null,
  };
  subscribers[key] = subscriber;
  persist(subscribers);
  return { subscriber, alreadyConfirmed: false };
}

function confirmByToken(token) {
  const entry = Object.values(subscribers).find(
    (s) => s.status === 'pending' && s.confirmToken === token
  );
  if (!entry) return null;
  entry.status = 'confirmed';
  entry.confirmedAt = new Date().toISOString();
  delete entry.confirmToken;
  persist(subscribers);
  return entry;
}

function removeByEmail(email) {
  const key = normalize(email);
  if (!subscribers[key]) return false;
  delete subscribers[key];
  persist(subscribers);
  return true;
}

function unsubscribeByToken(token) {
  const entry = Object.values(subscribers).find((s) => s.unsubscribeToken === token);
  if (!entry) return null;
  delete subscribers[entry.email];
  persist(subscribers);
  return entry.email;
}

module.exports = {
  getSubscriber,
  listConfirmed,
  createPending,
  confirmByToken,
  removeByEmail,
  unsubscribeByToken,
};
