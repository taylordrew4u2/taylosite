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
//
// Two modes. Where the backend can hold a record cheaply it does, which gives a
// list of signed-in devices and true single-session revocation. Where it cannot
// — storing a session in a git commit would be absurd — sessions are signed
// instead: the cookie carries its own expiry and an HMAC over it.

const base64url = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Signing key. Derived from the stored password by default, so changing the
 * password invalidates every outstanding cookie for free.
 */
function sessionSecret(site) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const record = (site && site.auth) || {};
  return `${record.hash || ''}:${record.salt || ''}`;
}

function sign(value, secret, label = 'session') {
  return crypto.createHmac('sha256', `${label}:${secret}`).update(value).digest('base64url');
}

function csrfFor(token, secret) {
  return sign(token, secret, 'csrf');
}

function mintSignedToken(site) {
  const secret = sessionSecret(site);
  const payload = base64url(
    JSON.stringify({
      iat: Date.now(),
      exp: Date.now() + SESSION_TTL_MS,
      v: ((site.auth || {}).tokenVersion) || 0
    })
  );
  const token = `${payload}.${sign(payload, secret)}`;
  return { token, secret };
}

function verifySignedToken(token, site) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const secret = sessionSecret(site);
  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!claims || claims.exp < Date.now()) return null;
  if ((claims.v || 0) !== (((site.auth || {}).tokenVersion) || 0)) return null;

  return {
    csrf: csrfFor(token, secret),
    createdAt: claims.iat,
    expiresAt: claims.exp,
    ip: '',
    agent: ''
  };
}

async function createSession(meta = {}) {
  if (store.statelessSessions()) {
    const site = await store.readSite();
    const { token, secret } = mintSignedToken(site);
    return {
      token,
      csrf: csrfFor(token, secret),
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
      ip: meta.ip || '',
      agent: String(meta.agent || '').slice(0, 200)
    };
  }

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
  if (store.statelessSessions()) {
    if (!token) return null;
    return verifySignedToken(token, await store.readSite());
  }

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
  // A signed cookie cannot be revoked individually — clearing it is the logout,
  // and "sign out everywhere" below invalidates the whole generation.
  if (store.statelessSessions()) return;
  if (token) await store.sessions.remove(token);
}

async function revokeAllSessions() {
  if (store.statelessSessions()) {
    await store.update((site) => {
      site.auth = { ...(site.auth || {}), tokenVersion: (((site.auth || {}).tokenVersion) || 0) + 1 };
      return site;
    }, { backup: false });
    return;
  }
  await store.sessions.clear();
}

async function listSessions(currentToken) {
  if (store.statelessSessions()) {
    const session = await getSession(currentToken);
    if (!session) return [];
    return [
      {
        id: 'this device',
        current: true,
        createdAt: new Date(session.createdAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
        ip: '',
        agent: 'Signed cookie — individual sessions are not tracked'
      }
    ];
  }

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
