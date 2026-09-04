'use strict';

/**
 * Reels, straight from the account.
 *
 * Instagram allows nobody to read a profile without credentials — the public
 * page redirects and the old JSON endpoint answers 401 — so the only honest
 * route is their own API with a token the account owner issues.
 *
 * The awkward part is that a long-lived token lasts 60 days and then dies for
 * good: Meta's rule is that a token not refreshed within 60 days can never be
 * refreshed again. A token pasted into an environment variable and forgotten
 * would therefore work all summer and break in the autumn, silently. So the
 * token is not left in the environment: it is exchanged, stored, and refreshed
 * by the site itself.
 *
 * Where it lives: `site.auth.instagram`. `auth` is the one branch of the site
 * document that `publicSite()` strips before anything is served and that
 * `normalizeSite()` never takes from user input, so a token there cannot leak
 * through /api/content or be overwritten by a form post.
 *
 * Environment:
 *
 *   INSTAGRAM_APP_ID       Instagram app ID, for the connect flow
 *   INSTAGRAM_APP_SECRET   Instagram app secret — server-side only, never sent
 *                          to the browser
 *   INSTAGRAM_TOKEN        optional seed: an existing long-lived token, adopted
 *                          and then kept alive like any other
 *   INSTAGRAM_USER_ID      whose media to read; defaults to `me`
 */

const GRAPH = 'https://graph.instagram.com';
const OAUTH = 'https://api.instagram.com';
const AUTHORIZE = 'https://www.instagram.com/oauth/authorize';
const SCOPE = 'instagram_business_basic';

const FIELDS = 'id,caption,media_type,media_product_type,media_url,permalink,thumbnail_url,timestamp';

const TTL_MS = 20 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Meta refuses to refresh a token younger than 24 hours, and refuses entirely
// once it has expired. Ten days of runway leaves room for a site nobody visits
// for a week without walking up to the cliff.
const REFRESH_WITHIN_MS = 10 * DAY_MS;
const MIN_AGE_MS = 25 * 60 * 60 * 1000;

let cache = { at: 0, reels: null, error: null };

function config(env = process.env) {
  return {
    appId: env.INSTAGRAM_APP_ID || '',
    appSecret: env.INSTAGRAM_APP_SECRET || '',
    seed: env.INSTAGRAM_TOKEN || env.IG_TOKEN || '',
    userId: env.INSTAGRAM_USER_ID || 'me',
    graph: (env.INSTAGRAM_API_BASE || GRAPH).replace(/\/+$/, ''),
    oauth: (env.INSTAGRAM_OAUTH_BASE || env.INSTAGRAM_API_BASE || OAUTH).replace(/\/+$/, ''),
    authorize: env.INSTAGRAM_AUTHORIZE_BASE || AUTHORIZE,
    limit: Math.min(Math.max(Number(env.INSTAGRAM_LIMIT) || 24, 1), 100)
  };
}

/** Whether the connect flow can be offered at all. */
function canConnect(env = process.env) {
  const { appId, appSecret } = config(env);
  return Boolean(appId && appSecret);
}

function stored(site) {
  const box = site && site.auth && site.auth.instagram;
  return box && box.token ? box : null;
}

/** Configured means "there is a token to try", stored or seeded. */
function isConfigured(env = process.env, site = null) {
  return Boolean(stored(site) || config(env).seed);
}

/** What the admin panel shows: never the token, only its state. */
function status(site, env = process.env) {
  const box = stored(site);
  const cfg = config(env);
  return {
    connected: Boolean(box || cfg.seed),
    source: box ? box.source || 'connected' : cfg.seed ? 'environment' : null,
    expiresAt: box ? box.expiresAt || null : null,
    canConnect: canConnect(env),
    scope: SCOPE
  };
}

/** Where Meta sends the app user back with a code. */
function authorizeUrl(origin, env = process.env) {
  const { appId, authorize } = config(env);
  if (!appId) return '';
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: SCOPE
  });
  return `${authorize}?${params}`;
}

/**
 * The admin panel itself. Meta matches this exactly against the app's list of
 * OAuth redirect URIs, so it is derived one way and one way only.
 */
function redirectUri(origin) {
  return `${String(origin || '').replace(/\/+$/, '')}/admin`;
}

async function asJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      (body && body.error && body.error.message) ||
      (body && body.error_message) ||
      `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return body;
}

/** Step 2: the one-hour code becomes a short-lived token. */
async function exchangeCode(code, origin, env = process.env) {
  const { appId, appSecret, oauth } = config(env);
  const form = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(origin),
    code: String(code || '').replace(/#_$/, '') // Meta appends this to the redirect
  });
  const body = await asJson(
    await fetch(`${oauth}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    })
  );
  // Their response has been both a bare object and a one-element `data` array.
  const first = Array.isArray(body.data) ? body.data[0] || {} : body;
  if (!first.access_token) throw new Error('Instagram returned no access token');
  return { token: first.access_token, userId: first.user_id || '' };
}

/** Step 3: the short-lived token becomes a 60-day one. */
async function toLongLived(shortToken, env = process.env) {
  const { appSecret, graph } = config(env);
  const params = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: appSecret,
    access_token: shortToken
  });
  const body = await asJson(await fetch(`${graph}/access_token?${params}`));
  if (!body.access_token) throw new Error('Instagram returned no long-lived token');
  return body;
}

/** And the same token, renewed for another 60 days. */
async function refreshToken(token, env = process.env) {
  const { graph } = config(env);
  const params = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token });
  const body = await asJson(await fetch(`${graph}/refresh_access_token?${params}`));
  if (!body.access_token) throw new Error('Instagram returned no refreshed token');
  return body;
}

function box(token, expiresIn, source, now) {
  return {
    token,
    source,
    obtainedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (Number(expiresIn) || 60 * 24 * 3600) * 1000).toISOString()
  };
}

async function persist(store, next) {
  await store.update((site) => {
    site.auth = site.auth || {};
    site.auth.instagram = next;
    return site;
  });
}

/** The whole connect dance, from the code in the redirect to a stored token. */
async function connect({ store, code, origin, env = process.env, now = Date.now() }) {
  if (!canConnect(env)) throw new Error('Set INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET first.');
  const short = await exchangeCode(code, origin, env);
  const long = await toLongLived(short.token, env);
  const next = box(long.access_token, long.expires_in, 'connected', now);
  if (short.userId) next.userId = String(short.userId);
  await persist(store, next);
  resetCache();
  return { expiresAt: next.expiresAt };
}

async function disconnect(store) {
  await persist(store, null);
  resetCache();
}

/**
 * The token to use now — adopting the environment seed on first sight, and
 * renewing anything close to expiry. Never throws: a refresh that fails leaves
 * the existing token in place to be tried, and to be retried tomorrow.
 */
async function currentToken({ store, site, env = process.env, now = Date.now() }) {
  const cfg = config(env);
  let held = stored(site);

  // A token pasted into the environment is adopted once, so that from then on
  // it is refreshed like any other rather than expiring where it sits.
  if (!held && cfg.seed) {
    held = box(cfg.seed, 60 * 24 * 3600, 'environment', now);
    if (store) await persist(store, held).catch(() => {});
  }
  if (!held) return null;

  const expiresAt = Date.parse(held.expiresAt || '') || 0;
  const obtainedAt = Date.parse(held.obtainedAt || '') || 0;
  const dueSoon = expiresAt && expiresAt - now < REFRESH_WITHIN_MS;
  const oldEnough = !obtainedAt || now - obtainedAt > MIN_AGE_MS;

  if (store && dueSoon && oldEnough && expiresAt > now) {
    try {
      const renewed = await refreshToken(held.token, env);
      const next = box(renewed.access_token, renewed.expires_in, held.source || 'connected', now);
      if (held.userId) next.userId = held.userId;
      await persist(store, next);
      return next.token;
    } catch (_) {
      // Keep using what we have; it is still valid for a few days yet.
    }
  }
  return held.token;
}

function captionText(caption) {
  const text = String(caption || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!text) return '';
  return text.replace(/(?:\s+#[\w.]+)+\s*$/u, '').trim().slice(0, 200);
}

function toReel(item) {
  return {
    id: `ig-${item.id}`,
    url: item.permalink || '',
    video: item.media_url || '',
    poster: item.thumbnail_url || '',
    caption: captionText(item.caption),
    visible: true,
    source: 'instagram'
  };
}

function isReel(item) {
  if (!item || !item.id) return false;
  const product = String(item.media_product_type || '').toUpperCase();
  if (product) return product === 'REELS';
  return String(item.media_type || '').toUpperCase() === 'VIDEO';
}

/**
 * The account's reels, newest first. Never throws: the wall degrades to what
 * was last seen, and then to the reels pinned by hand.
 */
async function fetchReels({ store, site, env = process.env, now = Date.now(), timeoutMs = 4000 } = {}) {
  const token = await currentToken({ store, site, env, now }).catch(() => null);
  if (!token) return { reels: [], configured: false, error: null };

  if (cache.reels && now - cache.at < TTL_MS) {
    return { reels: cache.reels, configured: true, error: null, cached: true };
  }

  const { userId, graph, limit } = config(env);
  const params = new URLSearchParams({ fields: FIELDS, limit: String(limit), access_token: token });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${graph}/${encodeURIComponent(userId)}/media?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    const body = await asJson(res);
    const reels = (Array.isArray(body.data) ? body.data : []).filter(isReel).map(toReel);
    cache = { at: now, reels, error: null };
    return { reels, configured: true, error: null };
  } catch (err) {
    const message = err.name === 'AbortError' ? 'Instagram did not answer in time' : `Instagram: ${err.message}`;
    const stale = cache.reels && now - cache.at < STALE_MS ? cache.reels : [];
    cache = { ...cache, error: message };
    return { reels: stale, configured: true, error: message, stale: stale.length > 0 };
  } finally {
    clearTimeout(timer);
  }
}

function resetCache() {
  cache = { at: 0, reels: null, error: null };
}

module.exports = {
  fetchReels,
  currentToken,
  connect,
  disconnect,
  status,
  authorizeUrl,
  redirectUri,
  isConfigured,
  canConnect,
  resetCache,
  captionText,
  isReel,
  toReel,
  config,
  SCOPE
};
