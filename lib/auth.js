'use strict';

const crypto = require('crypto');
const store = require('./store');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'td_session';

const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;
const attempts = new Map(); // ip -> { count, first, until }

const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'weed';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, record) {
  if (!record || !record.hash || !record.salt) return false;
  const candidate = crypto.scryptSync(String(password), record.salt, 64);
  const expected = Buffer.from(record.hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

/** Seed the shipped default password the first time the site boots. */
async function ensurePassword() {
  const site = await store.readSite();
  if (site.auth && site.auth.hash && site.auth.salt) return;
  const record = hashPassword(DEFAULT_PASSWORD);
  await store.update((s) => {
    s.auth = { ...record, updatedAt: new Date().toISOString(), isDefault: true };
    return s;
  }, { backup: false });
}

async function setPassword(password) {
  const record = hashPassword(password);
  await store.update((s) => {
    s.auth = { ...record, updatedAt: new Date().toISOString(), isDefault: false };
    return s;
  });
  await revokeAllSessions();
}

async function checkPassword(password) {
  let site = await store.readSite();
  // If the store was emptied out from under a running instance the document
  // comes back with no credentials. Re-seed rather than locking everyone out.
  if (!site.auth || !site.auth.hash) {
    await ensurePassword();
    site = await store.readSite();
  }
  return verifyPassword(password, site.auth);
}

async function usingDefaultPassword() {
  const site = await store.readSite();
  return Boolean(site.auth && site.auth.isDefault);
}

// ---------------------------------------------------------------- sessions

async function createSession(meta = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    csrf: crypto.randomBytes(24).toString('hex'),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    ip: meta.ip || '',
    agent: String(meta.agent || '').slice(0, 200)
  };
  await store.sessions.write(token, session, Math.floor(SESSION_TTL_MS / 1000));
  return { token, ...session };
}

async function getSession(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await store.sessions.read(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    await store.sessions.remove(token);
    return null;
  }
  return session;
}

async function revokeSession(token) {
  if (token) await store.sessions.remove(token);
}

async function revokeAllSessions() {
  await store.sessions.clear();
}

async function listSessions(currentToken) {
  const now = Date.now();
  const all = await store.sessions.list();
  return all
    .filter((s) => s.expiresAt > now)
    .map((s) => ({
      id: `${String(s.token).slice(0, 8)}…`,
      current: s.token === currentToken,
      createdAt: new Date(s.createdAt).toISOString(),
      expiresAt: new Date(s.expiresAt).toISOString(),
      ip: s.ip,
      agent: s.agent
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ------------------------------------------------------------ rate limiting

function loginBlocked(ip) {
  const entry = attempts.get(ip);
  if (!entry) return 0;
  if (entry.until && entry.until > Date.now()) return entry.until - Date.now();
  return 0;
}

function recordFailure(ip) {
  const now = Date.now();
  const entry = attempts.get(ip) || { count: 0, first: now, until: 0 };
  if (now - entry.first > LOCKOUT_MS) {
    entry.count = 0;
    entry.first = now;
  }
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.until = now + LOCKOUT_MS;
    entry.count = 0;
    entry.first = now;
  }
  attempts.set(ip, entry);
  return entry;
}

function clearFailures(ip) {
  attempts.delete(ip);
}

// --------------------------------------------------------------- cookies

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function sessionCookie(token, { secure }) {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

function clearCookie({ secure }) {
  const attrs = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

module.exports = {
  COOKIE_NAME,
  DEFAULT_PASSWORD,
  ensurePassword,
  setPassword,
  checkPassword,
  usingDefaultPassword,
  createSession,
  getSession,
  revokeSession,
  revokeAllSessions,
  listSessions,
  loginBlocked,
  recordFailure,
  clearFailures,
  parseCookies,
  sessionCookie,
  clearCookie
};
