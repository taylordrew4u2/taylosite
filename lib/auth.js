'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const SESSION_FILE = path.join(store.DATA_DIR, 'sessions.json');
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
function ensurePassword() {
  const site = store.readSite();
  if (site.auth && site.auth.hash && site.auth.salt) return;
  const record = hashPassword(DEFAULT_PASSWORD);
  store.update(
    (s) => {
      s.auth = { ...record, updatedAt: new Date().toISOString(), isDefault: true };
      return s;
    },
    { backup: false }
  );
}

function setPassword(password) {
  const record = hashPassword(password);
  store.update((s) => {
    s.auth = { ...record, updatedAt: new Date().toISOString(), isDefault: false };
    return s;
  });
  revokeAllSessions();
}

function checkPassword(password) {
  const site = store.readSite();
  return verifyPassword(password, site.auth);
}

function usingDefaultPassword() {
  const site = store.readSite();
  return Boolean(site.auth && site.auth.isDefault);
}

// ---------------------------------------------------------------- sessions

let sessions = loadSessions();

function loadSessions() {
  try {
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    const now = Date.now();
    return new Map(Object.entries(raw).filter(([, s]) => s.expiresAt > now));
  } catch (_) {
    return new Map();
  }
}

function persistSessions() {
  store.ensureDirs();
  const obj = Object.fromEntries(sessions);
  const tmp = `${SESSION_FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, SESSION_FILE);
  } catch (err) {
    console.error(`[auth] could not persist sessions: ${err.message}`);
  }
}

function createSession(meta = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    csrf: crypto.randomBytes(24).toString('hex'),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    ip: meta.ip || '',
    agent: String(meta.agent || '').slice(0, 200)
  };
  sessions.set(token, session);
  persistSessions();
  return { token, ...session };
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    persistSessions();
    return null;
  }
  return session;
}

function revokeSession(token) {
  if (sessions.delete(token)) persistSessions();
}

function revokeAllSessions() {
  sessions = new Map();
  persistSessions();
}

function listSessions(currentToken) {
  const now = Date.now();
  return [...sessions.entries()]
    .filter(([, s]) => s.expiresAt > now)
    .map(([token, s]) => ({
      id: `${token.slice(0, 8)}…`,
      current: token === currentToken,
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
