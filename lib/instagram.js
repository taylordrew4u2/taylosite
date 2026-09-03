'use strict';

/**
 * Reels, straight from the account.
 *
 * Instagram allows nobody to read a profile without credentials — the public
 * page redirects and the old JSON endpoint answers 401 — so the only honest
 * route is their own API with a token the account owner issues. That is what
 * this does.
 *
 * Two environment variables:
 *
 *   INSTAGRAM_TOKEN     a long-lived access token for an Instagram
 *                       Business or Creator account (required)
 *   INSTAGRAM_USER_ID   whose media to read; defaults to `me`, which is the
 *                       account the token belongs to
 *
 * The MP4 behind `media_url` is signed and expires within hours, which is why
 * nothing here is written into the site document: the wall is rendered from a
 * short-lived cache and re-fetched, so the links a visitor gets are always
 * fresh ones. A stale copy is still served if Instagram is unreachable — an
 * outage there should not blank the page.
 */

const DEFAULT_BASE = 'https://graph.instagram.com';
const FIELDS = 'id,caption,media_type,media_product_type,media_url,permalink,thumbnail_url,timestamp';

// Long enough that a busy site makes a handful of calls an hour (the limit is
// 200), short enough that a signed media URL never goes stale in the cache.
const TTL_MS = 20 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;

let cache = { at: 0, reels: null, error: null };

function config(env = process.env) {
  return {
    token: env.INSTAGRAM_TOKEN || env.IG_TOKEN || '',
    userId: env.INSTAGRAM_USER_ID || 'me',
    base: (env.INSTAGRAM_API_BASE || DEFAULT_BASE).replace(/\/+$/, ''),
    limit: Math.min(Math.max(Number(env.INSTAGRAM_LIMIT) || 24, 1), 100)
  };
}

function isConfigured(env = process.env) {
  return Boolean(config(env).token);
}

/** The first line of a caption is the closest thing a reel has to a title. */
function captionText(caption) {
  const text = String(caption || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!text) return '';
  // Hashtag tails read as noise when a screen reader says them out loud.
  return text.replace(/(?:\s+#[\w.]+)+\s*$/u, '').trim().slice(0, 200);
}

/**
 * A reel, in the shape the page already renders. `media_url` is the MP4, which
 * is what makes an autoplaying silent loop possible at all — an embed cannot.
 */
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

/**
 * Reels only. `media_product_type` names them outright on accounts that report
 * it; where it is absent, a video is the closest available answer, and a photo
 * is never a reel.
 */
function isReel(item) {
  if (!item || !item.id) return false;
  const product = String(item.media_product_type || '').toUpperCase();
  if (product) return product === 'REELS';
  return String(item.media_type || '').toUpperCase() === 'VIDEO';
}

async function request(url, signal) {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (body && body.error && body.error.message) || `HTTP ${res.status}`;
    // A token that has expired is the failure worth naming — it is the one the
    // owner has to act on, and it looks identical to "no reels" from outside.
    throw new Error(`Instagram: ${detail}`);
  }
  return body;
}

/**
 * The account's reels, newest first. Never throws: the wall degrades to
 * whatever was last seen, and then to the reels added by hand.
 */
async function fetchReels({ env = process.env, now = Date.now(), timeoutMs = 4000 } = {}) {
  const { token, userId, base, limit } = config(env);
  if (!token) return { reels: [], configured: false, error: null };

  if (cache.reels && now - cache.at < TTL_MS) {
    return { reels: cache.reels, configured: true, error: null, cached: true };
  }

  const url = `${base}/${encodeURIComponent(userId)}/media?fields=${FIELDS}&limit=${limit}&access_token=${encodeURIComponent(token)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = await request(url, controller.signal);
    const reels = (Array.isArray(body.data) ? body.data : []).filter(isReel).map(toReel);
    cache = { at: now, reels, error: null };
    return { reels, configured: true, error: null };
  } catch (err) {
    const message = err.name === 'AbortError' ? 'Instagram did not answer in time' : err.message;
    // Serving yesterday's wall beats serving none, but only for a day.
    const stale = cache.reels && now - cache.at < STALE_MS ? cache.reels : [];
    cache = { ...cache, error: message };
    return { reels: stale, configured: true, error: message, stale: stale.length > 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Tests and the admin panel both need to forget what was seen. */
function resetCache() {
  cache = { at: 0, reels: null, error: null };
}

module.exports = { fetchReels, isConfigured, resetCache, captionText, isReel, toReel, config };
