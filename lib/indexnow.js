'use strict';

/**
 * IndexNow — telling the search engines a page changed, instead of waiting to
 * be asked.
 *
 * A crawler decides for itself how often to come back, and for a small site
 * that can be weeks. IndexNow inverts it: publish a key file at the site root,
 * then POST the URLs that changed, and Bing and Yandex fetch them within
 * minutes. Bing matters more than its search share suggests — it is what sits
 * behind Copilot and ChatGPT's web results.
 *
 * There is no account and no verification step. Ownership is proved by the key
 * file, which only someone who can write to the site could have put there, so
 * this works with nothing signed in anywhere.
 *
 * Google does not take IndexNow. Nothing here substitutes for Search Console.
 */

const crypto = require('node:crypto');

const ENDPOINT = 'https://api.indexnow.org/IndexNow';
const TIMEOUT_MS = 4000;

/** The key is a shared secret only in the sense that it must match the file. */
function generateKey() {
  return crypto.randomBytes(16).toString('hex');
}

function stored(site) {
  const key = site && site.auth && site.auth.indexNowKey;
  return /^[a-f0-9]{8,128}$/i.test(String(key || '')) ? String(key) : '';
}

/**
 * The key, minting one on first use. Kept beside the other credentials so it
 * is stripped from every public read of the site.
 */
async function ensureKey(store, site) {
  const held = stored(site);
  if (held) return held;
  const key = generateKey();
  if (!store) return key;
  await store.update((s) => {
    s.auth = s.auth || {};
    if (!stored(s)) s.auth.indexNowKey = key;
    return s;
  });
  const after = await store.readSite().catch(() => null);
  return stored(after) || key;
}

/** Whether a request path is the key file, and should be answered with the key. */
function keyFileFor(pathname, key) {
  if (!key) return false;
  return pathname === `/${key}.txt`;
}

/**
 * Submit changed URLs. Never throws and never blocks a save: a search engine
 * being slow is not a reason for her save button to spin.
 */
async function submit({ origin, key, urls, endpoint = ENDPOINT, timeoutMs = TIMEOUT_MS }) {
  if (!key || !origin || !urls || !urls.length) return { ok: false, skipped: true };

  let host;
  try {
    host = new URL(origin).host;
  } catch (_) {
    return { ok: false, skipped: true };
  }

  const payload = {
    host,
    key,
    keyLocation: `${origin.replace(/\/+$/, '')}/${key}.txt`,
    urlList: urls.slice(0, 10000)
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    // 200 accepted, 202 accepted but the key is still being checked. Both fine.
    return { ok: res.status === 200 || res.status === 202, status: res.status, count: payload.urlList.length };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** The pages worth announcing — the ones that exist and that a person reads. */
function siteUrls(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return ['/', '/about', '/links', '/reels'].map((p) => (p === '/' ? `${base}/` : base + p));
}

module.exports = { ensureKey, keyFileFor, submit, siteUrls, generateKey, stored, ENDPOINT };
