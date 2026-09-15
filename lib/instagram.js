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
 *   INSTAGRAM_MESSAGING    opt in to direct messages: also ask for the
 *                          messaging permission and expose sendMessage()
 *   INSTAGRAM_GRAPH_VERSION  graph version for the Send API; defaults to v25.0
 */

const GRAPH = 'https://graph.instagram.com';
const OAUTH = 'https://api.instagram.com';
const AUTHORIZE = 'https://www.instagram.com/oauth/authorize';
const SCOPE = 'instagram_business_basic';
// Sending a direct message is a second permission, and asking for one the app
// has not been set up to grant makes Meta refuse the whole authorization — so
// it is asked for only when the owner has said they want it.
const MESSAGING_SCOPE = 'instagram_business_manage_messages';
// The Send API is the one call here that is versioned in its path rather than
// answering at the bare graph root.
const VERSION = 'v25.0';
// Meta's own ceiling for the text of a direct message.
const MESSAGE_MAX = 1000;

const FIELDS = 'id,caption,media_type,media_product_type,media_url,permalink,thumbnail_url,timestamp';

const TTL_MS = 20 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Meta refuses to refresh a token younger than 24 hours, and refuses entirely
// once it has expired. Ten days of runway leaves room for a site nobody visits
// for a week without walking up to the cliff.
const REFRESH_WITHIN_MS = 10 * DAY_MS;
const MIN_AGE_MS = 25 * 60 * 60 * 1000;

let cache = { at: 0, key: '', reels: null, error: null };
// Pages past the first, keyed by the cursor that fetched them. The wall
// scrolls on for as long as the account has reels, and every page it has
// already been shown is worth keeping for the next visitor who scrolls that
// far — but not forever, so the map is capped rather than left to grow.
const PAGE_CACHE_MAX = 64;
let pages = new Map();


/**
 * The app's own credentials, from wherever they were put. Pasting them into
 * the admin panel is the path that asks nothing of the hosting dashboard, so
 * it wins over the environment when both are present.
 */
function appCreds(env = process.env, site = null) {
  const saved = (site && site.auth && site.auth.instagramApp) || {};
  return {
    appId: String(saved.appId || env.INSTAGRAM_APP_ID || ''),
    appSecret: String(saved.appSecret || env.INSTAGRAM_APP_SECRET || '')
  };
}

/**
 * Credentials travel as an env-shaped object so every function below keeps its
 * single `env` argument, whether the values came from the dashboard or the
 * admin panel.
 */
function envWithApp(env = process.env, site = null) {
  const { appId, appSecret } = appCreds(env, site);
  if (!appId && !appSecret) return env;
  return { ...env, INSTAGRAM_APP_ID: appId, INSTAGRAM_APP_SECRET: appSecret };
}

function config(env = process.env) {
  return {
    appId: env.INSTAGRAM_APP_ID || '',
    appSecret: env.INSTAGRAM_APP_SECRET || '',
    seed: env.INSTAGRAM_TOKEN || env.IG_TOKEN || '',
    userId: env.INSTAGRAM_USER_ID || 'me',
    graph: (env.INSTAGRAM_API_BASE || GRAPH).replace(/\/+$/, ''),
    oauth: (env.INSTAGRAM_OAUTH_BASE || env.INSTAGRAM_API_BASE || OAUTH).replace(/\/+$/, ''),
    authorize: env.INSTAGRAM_AUTHORIZE_BASE || AUTHORIZE,
    version: String(env.INSTAGRAM_GRAPH_VERSION || VERSION).replace(/^\/+|\/+$/g, ''),
    limit: Math.min(Math.max(Number(env.INSTAGRAM_LIMIT) || 24, 1), 100)
  };
}

/** Whether the connect flow can be offered at all. */
function canConnect(env = process.env) {
  const { appId, appSecret } = config(env);
  return Boolean(appId && appSecret);
}

/**
 * Whether this deployment wants to send direct messages at all. Reading the
 * account needs one permission; writing to someone's inbox needs another, and
 * an app that was never set up for messaging cannot grant it — asking anyway
 * would break the connect flow that already works. So it is opt-in.
 */
function messagingEnabled(env = process.env, site = null) {
  const saved = (site && site.auth && site.auth.instagramApp) || {};
  if (saved.messaging != null) return Boolean(saved.messaging);
  return /^(1|true|yes|on)$/i.test(String(env.INSTAGRAM_MESSAGING || ''));
}

/** What the authorize window asks the account owner to approve. */
function scopeFor(env = process.env, site = null) {
  return messagingEnabled(env, site) ? `${SCOPE},${MESSAGING_SCOPE}` : SCOPE;
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
  const merged = envWithApp(env, site);
  const cfg = config(merged);
  const saved = (site && site.auth && site.auth.instagramApp) || {};
  return {
    connected: Boolean(box || cfg.seed),
    source: box ? box.source || 'connected' : cfg.seed ? 'environment' : null,
    expiresAt: box ? box.expiresAt || null : null,
    username: box ? box.username || '' : '',
    canConnect: canConnect(merged),
    // The secret itself never leaves the server; only the fact that it is set,
    // and the app id, which Meta puts in the address bar anyway.
    appId: cfg.appId,
    appSecretSet: Boolean(cfg.appSecret),
    appSource: saved.appId ? 'panel' : cfg.appId ? 'environment' : null,
    messaging: messagingEnabled(merged, site),
    // Whether this token can actually send. Meta's own word for it wins:
    // an authorize URL built in their dashboard grants every permission the
    // app has, so a token minted that way can send however the box was ticked
    // here. Only where they said nothing does the local flag stand in.
    messagingScope: box ? tokenCanMessage(box) : Boolean(cfg.seed),
    scope: scopeFor(merged, site)
  };
}

/**
 * Whether a stored token carries the messaging permission. The list Meta
 * returned is the authority; an older token that predates the list falls back
 * to what was asked for when it was issued.
 */
function tokenCanMessage(held) {
  if (!held) return false;
  const scopes = Array.isArray(held.scopes) ? held.scopes : [];
  if (scopes.length) return scopes.includes(MESSAGING_SCOPE);
  // Where Meta said nothing: a token this site minted is judged by what it
  // asked for, because that much is known. A token handed to us — pasted or
  // seeded from the environment — had its grant negotiated somewhere else, so
  // guessing it cannot send would be worse than letting Meta say so.
  return held.source === 'connected' ? Boolean(held.messaging) : true;
}

/** Save the pair from the admin panel. Either field may be left alone. */
async function saveApp({ store, appId, appSecret, messaging }) {
  const id = String(appId == null ? '' : appId).trim();
  const secret = String(appSecret == null ? '' : appSecret).trim();
  if (!/^[0-9]{6,}$/.test(id)) throw new Error('An Instagram app ID is all digits.');
  if (secret && !/^[a-f0-9]{16,}$/i.test(secret)) throw new Error('That does not look like an app secret.');
  await store.update((site) => {
    site.auth = site.auth || {};
    const prev = site.auth.instagramApp || {};
    site.auth.instagramApp = {
      appId: id,
      appSecret: secret || prev.appSecret || '',
      messaging: messaging == null ? Boolean(prev.messaging) : Boolean(messaging)
    };
    return site;
  });
  resetCache();
}

/**
 * Adopt a long-lived token pasted into the panel.
 *
 * The connect flow is the better road and stays the default, but it needs a
 * Meta app with a registered redirect URI. A token minted anywhere else — the
 * dashboard's own authorize URL, say — otherwise had nowhere to go but an
 * environment variable and a redeploy. Once stored it is kept alive by the
 * same refresh machinery as any other, which is the whole reason not to leave
 * it in the environment.
 *
 * It is checked against the account before it is saved: a token that cannot
 * read `/me` is a typo or a dead token, and storing one would replace a
 * working connection with a broken one.
 */
async function saveToken({ store, token, env = process.env, now = Date.now(), timeoutMs = 8000 }) {
  const value = String(token == null ? '' : token).trim();
  if (!value) throw new Error('Paste the access token first.');
  if (/\s/.test(value)) throw new Error('An access token has no spaces in it — check for a stray line break.');
  if (value.length < 40) throw new Error('That is too short to be a long-lived access token.');

  const { graph } = config(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let me;
  try {
    const params = new URLSearchParams({ fields: 'id,username', access_token: value });
    me = await asJson(await fetch(`${graph}/me?${params}`, { signal: controller.signal }));
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Instagram did not answer in time');
    throw new Error(`Instagram would not accept that token: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  // Meta states no permissions here, so the grant is left unstated rather than
  // invented; tokenCanMessage treats a handed-over token as able until Meta
  // says otherwise.
  const next = box(value, 60 * 24 * 3600, 'pasted', now, true, []);
  if (me.id) next.userId = String(me.id);
  if (me.username) next.username = String(me.username);
  await persist(store, next);
  resetCache();
  return { username: next.username || '', userId: next.userId || '', expiresAt: next.expiresAt };
}

async function forgetApp(store) {
  await store.update((site) => {
    if (site.auth) delete site.auth.instagramApp;
    return site;
  });
  resetCache();
}

/**
 * The permissions Meta says it granted. Their spelling has been both a
 * comma-separated string and an array, and on some responses it is absent
 * altogether — an empty list then means "not stated", never "none granted".
 */
function grantedScopes(value) {
  const list = Array.isArray(value) ? value : String(value == null ? '' : value).split(',');
  return list.map((one) => String(one).trim()).filter(Boolean);
}

/** Where Meta sends the app user back with a code. */
function authorizeUrl(origin, env = process.env, site = null) {
  const merged = envWithApp(env, site);
  const { appId, authorize } = config(merged);
  if (!appId) return '';
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: scopeFor(merged, site),
    // Meta's own dashboard ships this, and widening the scope is exactly why
    // it matters: without it an account with a live session can be handed a
    // fresh token carrying the *old* grant, never seeing the consent screen
    // for the permission just asked for. Reconnecting would then appear to
    // work and still not be able to send.
    force_reauth: 'true'
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
  return {
    token: first.access_token,
    userId: first.user_id || '',
    scopes: grantedScopes(first.permissions)
  };
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

function box(token, expiresIn, source, now, messaging = false, scopes = []) {
  return {
    token,
    source,
    messaging: Boolean(messaging),
    scopes: Array.isArray(scopes) ? scopes : [],
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
async function connect({ store, code, origin, env = process.env, site = null, now = Date.now() }) {
  const merged = envWithApp(env, site || (store ? await store.readSite().catch(() => null) : null));
  if (!canConnect(merged)) throw new Error('Add your Instagram app ID and secret first.');
  const short = await exchangeCode(code, origin, merged);
  const long = await toLongLived(short.token, merged);
  const next = box(
    long.access_token,
    long.expires_in,
    'connected',
    now,
    messagingEnabled(merged, site),
    // What the account owner actually approved, which may be wider than what
    // was asked for — an authorize URL built in Meta's dashboard grants every
    // permission the app has.
    short.scopes.length ? short.scopes : grantedScopes(long.permissions)
  );
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
  env = envWithApp(env, site);
  const cfg = config(env);
  let held = stored(site);

  // A token pasted into the environment is adopted once, so that from then on
  // it is refreshed like any other rather than expiring where it sits.
  if (!held && cfg.seed) {
    held = box(cfg.seed, 60 * 24 * 3600, 'environment', now, true);
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
      // A refresh renews the same grant and says nothing about it, so the
      // permissions already known are carried across rather than lost.
      const next = box(
        renewed.access_token,
        renewed.expires_in,
        held.source || 'connected',
        now,
        held.messaging,
        held.scopes
      );
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

/** Where the next page starts, or null when this was the last one. */
function nextCursor(body) {
  const paging = (body && body.paging) || {};
  const after = paging.cursors && paging.cursors.after;
  return paging.next && after ? String(after) : null;
}

function rememberPage(after, page) {
  pages.delete(after);
  pages.set(after, page);
  while (pages.size > PAGE_CACHE_MAX) pages.delete(pages.keys().next().value);
}

/**
 * The account's reels, newest first. Never throws: the wall degrades to what
 * was last seen, and then to the reels pinned by hand.
 *
 * `after` is the cursor Instagram handed back with the previous page. The
 * answer carries `next`, the cursor for the page after this one, or null once
 * the account has no more — which is how the wall knows when to stop asking.
 */
async function fetchReels({ store, site, env = process.env, now = Date.now(), timeoutMs = 4000, after = '' } = {}) {
  const token = await currentToken({ store, site, env, now }).catch(() => null);
  if (!token) return { reels: [], configured: false, error: null };

  if (!after && cache.reels && now - cache.at < TTL_MS) {
    return { reels: cache.reels, next: cache.next || null, configured: true, error: null, cached: true };
  }
  const held = after ? pages.get(after) : null;
  if (held && now - held.at < TTL_MS) {
    return { reels: held.reels, next: held.next, configured: true, error: null, cached: true };
  }

  const { userId, graph, limit } = config(env);
  const params = new URLSearchParams({ fields: FIELDS, limit: String(limit), access_token: token });
  if (after) params.set('after', after);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${graph}/${encodeURIComponent(userId)}/media?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    const body = await asJson(res);
    const reels = (Array.isArray(body.data) ? body.data : []).filter(isReel).map(toReel);
    const next = nextCursor(body);
    if (after) rememberPage(after, { at: now, reels, next });
    else cache = { at: now, reels, next, error: null };
    return { reels, next, configured: true, error: null };
  } catch (err) {
    const message = err.name === 'AbortError' ? 'Instagram did not answer in time' : `Instagram: ${err.message}`;
    if (after) {
      // A later page that fails just stops the scroll where it is; the wall
      // above it is still standing, and a retry is one scroll away.
      return { reels: [], next: null, configured: true, error: message };
    }
    const stale = cache.reels && now - cache.at < STALE_MS ? cache.reels : [];
    cache = { ...cache, error: message };
    return { reels: stale, next: stale.length ? cache.next || null : null, configured: true, error: message, stale: stale.length > 0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a direct message from the connected account.
 *
 * Three things about this call trip people up, and all three are handled here
 * rather than left to whoever writes the request:
 *
 *  - The bearer is the **access token**, not the app ID. An app ID is public,
 *    it identifies nobody, and Meta answers a request bearing one with an
 *    opaque OAuth error. The token used is the stored long-lived one, kept
 *    alive by `currentToken`, so this never goes stale the way a pasted one does.
 *  - The recipient is an **Instagram-scoped ID** — the all-digit `sender.id`
 *    that arrives on a messaging webhook — not an @handle and not the number
 *    on the profile. There is no lookup from a handle to one; you learn it
 *    because they messaged you.
 *  - Instagram only allows a reply inside the **24 hours** after that person's
 *    last message. Outside it, Meta refuses, and their refusal is passed
 *    through here verbatim because their wording says which rule was hit.
 */
async function sendMessage({
  store,
  site,
  env = process.env,
  recipientId,
  text,
  now = Date.now(),
  timeoutMs = 8000
} = {}) {
  const id = String(recipientId == null ? '' : recipientId).trim();
  const message = String(text == null ? '' : text).trim();

  if (!id) throw new Error('A direct message needs a recipient.');
  if (!/^[0-9]{1,32}$/.test(id)) {
    throw new Error(
      'A recipient is an Instagram-scoped ID — the all-digit sender id a message webhook hands you, not an @handle.'
    );
  }
  if (!message) throw new Error('A direct message needs some text.');
  if (message.length > MESSAGE_MAX) {
    throw new Error(`Instagram refuses a direct message longer than ${MESSAGE_MAX} characters.`);
  }

  const merged = envWithApp(env, site);
  const token = await currentToken({ store, site, env: merged, now });
  if (!token) throw new Error('Connect the Instagram account first — sending a message needs its access token.');

  const { userId, graph, version } = config(merged);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = await asJson(
      await fetch(`${graph}/${version}/${encodeURIComponent(userId)}/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ recipient: { id }, message: { text: message } })
      })
    );
    return {
      recipientId: String(body.recipient_id || id),
      messageId: String(body.message_id || '')
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Instagram did not answer in time');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A hosted Instagram connector's feed, read from one pasted URL.
 *
 * This exists so that connecting the account costs one login and one paste,
 * rather than a Meta developer app. Services like Behold hold the Meta app on
 * your behalf: you log in with Instagram there, they hand you a JSON URL.
 *
 * Their shapes differ in spelling but not in substance, so the mapping below
 * accepts the obvious variants rather than tying the site to one vendor. If a
 * feed arrives in a shape nothing here recognises, the wall says so instead of
 * rendering blanks.
 */
function reelFromFeedItem(item) {
  if (!item || typeof item !== 'object') return null;
  const pick = (...keys) => {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };

  const permalink = pick('permalink', 'link', 'postUrl', 'post_url', 'full_url', 'sourceUrl', 'url');
  const video = pick('mediaUrl', 'media_url', 'videoUrl', 'video_url', 'video', 'videoSrc');
  const poster = pick(
    'thumbnailUrl', 'thumbnail_url', 'thumbnail', 'previewUrl', 'imageUrl', 'image_url', 'image', 'displayUrl', 'src'
  );
  const kind = pick('mediaType', 'media_type', 'type', 'postType', 'post_type').toUpperCase();
  const product = pick('mediaProductType', 'media_product_type').toUpperCase();

  // Photos are not reels. Where the feed says nothing about type, a video URL
  // is the tell — and a post with neither video nor picture is nothing at all.
  if (kind === 'IMAGE' || kind === 'PHOTO') return null;
  if (product && product !== 'REELS') return null;
  if (!video && !poster) return null;

  const id = pick('id', 'mediaId', 'media_id', 'shortcode') || permalink;
  if (!id) return null;

  return {
    id: `ig-${id}`,
    url: permalink,
    // A poster in the video slot would never play; keep them apart.
    video: /\.(mp4|webm|mov)(\?|$)/i.test(video) || kind === 'VIDEO' || product === 'REELS' ? video : '',
    poster,
    caption: captionText(pick('caption', 'text', 'title', 'message', 'description')),
    visible: true,
    source: 'instagram'
  };
}

/**
 * Find the posts in whatever the service sent.
 *
 * Every one of these wraps the same list differently — a bare array, `data`,
 * `posts`, or `posts.items` a level down — and picking a vendor is the owner's
 * business, not the site's. So rather than encoding one shape, this looks for
 * the first array of post-shaped objects, breadth-first and shallow, and gives
 * up rather than guessing deep.
 */
const FEED_KEYS = ['data', 'media', 'posts', 'items', 'results', 'feed', 'entries'];

function looksLikePosts(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => item && typeof item === 'object' && !Array.isArray(item))
  );
}

function feedItems(body, depth = 0) {
  if (looksLikePosts(body)) return body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || depth > 2) return [];
  // Named keys first, so a feed that also carries some unrelated array is read
  // the way its author intended.
  for (const key of FEED_KEYS) {
    if (looksLikePosts(body[key])) return body[key];
  }
  for (const key of FEED_KEYS) {
    if (body[key] && typeof body[key] === 'object') {
      const found = feedItems(body[key], depth + 1);
      if (found.length) return found;
    }
  }
  for (const value of Object.values(body)) {
    if (looksLikePosts(value)) return value;
  }
  return [];
}

/**
 * The mistake this field invites: pasting the Instagram page itself. It looks
 * like the right answer and cannot possibly work — Instagram serves HTML to a
 * browser and a login wall to everything else — so it is worth naming rather
 * than letting it fail as a generic fetch error.
 */
function feedUrlProblem(feedUrl) {
  let host = '';
  try {
    host = new URL(feedUrl).hostname.replace(/^www\./, '');
  } catch (_) {
    return 'that does not look like a URL';
  }
  if (/(^|\.)instagram\.com$/i.test(host) || /(^|\.)instagr\.am$/i.test(host)) {
    return 'instagram-profile';
  }
  return '';
}

/** The @handle in an Instagram profile URL, if that is what was pasted. */
function instagramHandle(feedUrl) {
  try {
    const url = new URL(feedUrl);
    if (!/(^|\.)instagram\.com$/i.test(url.hostname.replace(/^www\./, ''))) return '';
    const first = url.pathname.split('/').filter(Boolean)[0] || '';
    // /reel/… and /p/… are posts, not people.
    if (!first || ['reel', 'reels', 'p', 'tv', 'stories', 'explore'].includes(first.toLowerCase())) return '';
    return /^[A-Za-z0-9._]{1,30}$/.test(first) ? first : '';
  } catch (_) {
    return '';
  }
}

async function fetchFeedUrl(feedUrl, { now = Date.now(), timeoutMs = 5000 } = {}) {
  if (!feedUrl) return { reels: [], configured: false, error: null };

  const problem = feedUrlProblem(feedUrl);
  if (problem === 'instagram-profile') {
    // Nothing can read this — six of Instagram's endpoints were tried and all
    // of them require a login. Rather than an error, the page says where the
    // reels actually are and sends people there.
    return { reels: [], configured: true, error: null, profile: instagramHandle(feedUrl), profileUrl: feedUrl };
  }
  if (problem) return { reels: [], configured: true, error: `Instagram feed: ${problem}.` };

  if (cache.reels && cache.key === feedUrl && now - cache.at < TTL_MS) {
    return { reels: cache.reels, configured: true, error: null, cached: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(feedUrl, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`the feed answered ${res.status}`);
    const body = await res.json();
    const raw = feedItems(body);
    const reels = raw.map(reelFromFeedItem).filter(Boolean);
    if (!reels.length && raw.length) {
      throw new Error('the feed had posts, but none looked like reels');
    }
    cache = { at: now, key: feedUrl, reels, error: null };
    return { reels, configured: true, error: null };
  } catch (err) {
    const message = err.name === 'AbortError' ? 'the feed did not answer in time' : err.message;
    const stale = cache.reels && cache.key === feedUrl && now - cache.at < STALE_MS ? cache.reels : [];
    cache = { ...cache, error: message };
    return { reels: stale, configured: true, error: `Instagram feed: ${message}`, stale: stale.length > 0 };
  } finally {
    clearTimeout(timer);
  }
}

function resetCache() {
  cache = { at: 0, key: '', reels: null, error: null };
  pages = new Map();
}

module.exports = {
  saveApp,
  saveToken,
  sendMessage,
  messagingEnabled,
  tokenCanMessage,
  grantedScopes,
  scopeFor,
  forgetApp,
  envWithApp,
  fetchReels,
  fetchFeedUrl,
  feedUrlProblem,
  instagramHandle,
  reelFromFeedItem,
  feedItems,
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
  SCOPE,
  MESSAGING_SCOPE,
  MESSAGE_MAX
};
