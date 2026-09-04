'use strict';

const test = require('node:test');
const assert = require('node:assert');

const instagram = require('../lib/instagram');
const { startFakeInstagram } = require('./helpers/fake-instagram');

const REEL = {
  id: '111',
  caption: 'Crowd work at the Cellar\nsecond line #comedy #nyc',
  media_type: 'VIDEO',
  media_product_type: 'REELS',
  media_url: 'https://cdn.example/111.mp4?sig=abc',
  permalink: 'https://www.instagram.com/reel/AAA/',
  thumbnail_url: 'https://cdn.example/111.jpg',
  timestamp: '2026-08-01T12:00:00+0000'
};
const PHOTO = { id: '222', media_type: 'IMAGE', media_product_type: 'FEED', permalink: 'https://www.instagram.com/p/BBB/' };
const FEED_VIDEO = { id: '333', media_type: 'VIDEO', media_product_type: 'FEED', permalink: 'https://www.instagram.com/p/CCC/' };

/** Just enough of lib/store to hold a site document in memory. */
function fakeStore(site = { auth: {} }) {
  return {
    site,
    async update(mutator) {
      this.site = (await mutator(this.site)) || this.site;
      return this.site;
    },
    async readSite() {
      return this.site;
    }
  };
}

async function withApi(opts, fn) {
  const api = await startFakeInstagram(opts);
  instagram.resetCache();
  try {
    return await fn(api, {
      INSTAGRAM_TOKEN: 'tok',
      INSTAGRAM_API_BASE: api.base,
      INSTAGRAM_OAUTH_BASE: api.base
    });
  } finally {
    await api.stop();
    instagram.resetCache();
  }
}

test('with no token the account is simply not connected', async () => {
  instagram.resetCache();
  const out = await instagram.fetchReels({ env: {} });
  assert.deepStrictEqual(out, { reels: [], configured: false, error: null });
});

test('reels come back as tiles the wall can play', async () => {
  await withApi({ media: [REEL, PHOTO, FEED_VIDEO] }, async (api, env) => {
    const out = await instagram.fetchReels({ env });

    assert.strictEqual(out.configured, true);
    assert.strictEqual(out.error, null);
    assert.strictEqual(out.reels.length, 1, 'a photo is not a reel, and neither is a feed video');
    assert.deepStrictEqual(out.reels[0], {
      id: 'ig-111',
      url: 'https://www.instagram.com/reel/AAA/',
      video: 'https://cdn.example/111.mp4?sig=abc',
      poster: 'https://cdn.example/111.jpg',
      caption: 'Crowd work at the Cellar',
      visible: true,
      source: 'instagram'
    });

    assert.strictEqual(api.calls[0].token, 'tok', 'the token travels as a query parameter, as their API wants');
    assert.match(api.calls[0].fields, /media_url/, 'and the MP4 is asked for — it is what makes the loop possible');
  });
});

test('a second read inside the window is served from cache', async () => {
  await withApi({ media: [REEL] }, async (api, env) => {
    await instagram.fetchReels({ env });
    const again = await instagram.fetchReels({ env });
    assert.strictEqual(again.cached, true);
    assert.strictEqual(api.calls.length, 1, 'one call, not two');

    // Past the TTL it goes back for fresh signed URLs.
    await instagram.fetchReels({ env, now: Date.now() + 21 * 60 * 1000 });
    assert.strictEqual(api.calls.length, 2);
  });
});

test('an expired token is reported rather than swallowed', async () => {
  await withApi({ media: [REEL], state: { expired: true } }, async (api, env) => {
    const out = await instagram.fetchReels({ env });
    assert.strictEqual(out.configured, true);
    assert.deepStrictEqual(out.reels, []);
    assert.match(out.error, /Session has expired/, 'the owner has to renew it, so say so');
  });
});

test('an outage serves the last good wall rather than an empty one', async () => {
  await withApi({ media: [REEL] }, async (api, env) => {
    const good = await instagram.fetchReels({ env });
    assert.strictEqual(good.reels.length, 1);

    api.state.down = true;
    const later = await instagram.fetchReels({ env, now: Date.now() + 21 * 60 * 1000 });
    assert.strictEqual(later.reels.length, 1, 'yesterday’s wall beats a blank page');
    assert.strictEqual(later.stale, true);
    assert.match(later.error, /Instagram/);
  });
});

test('a hanging API gives up instead of hanging the page', async () => {
  await withApi({ media: [REEL], state: { hangMs: 300 } }, async (api, env) => {
    const out = await instagram.fetchReels({ env, timeoutMs: 50 });
    assert.deepStrictEqual(out.reels, []);
    assert.match(out.error, /did not answer in time/);
  });
});

test('a caption keeps its first line and drops the hashtag tail', () => {
  assert.strictEqual(instagram.captionText('Roast battle\n\nmore text'), 'Roast battle');
  assert.strictEqual(instagram.captionText('Skankfest #comedy #standup'), 'Skankfest');
  assert.strictEqual(instagram.captionText(''), '');
  assert.strictEqual(instagram.captionText(null), '');
});

// --------------------------------------------------------------- the token

test('the connect flow turns a code into a stored long-lived token', async () => {
  await withApi({ media: [REEL] }, async (api, env) => {
    const store = fakeStore();
    const out = await instagram.connect({
      store,
      code: 'AQBx-hBsH3...#_',
      origin: 'https://example.com',
      env: { ...env, INSTAGRAM_APP_ID: '99', INSTAGRAM_APP_SECRET: 'sh' }
    });

    const held = store.site.auth.instagram;
    assert.strictEqual(held.token, 'long-token', 'the 60-day token, not the short one');
    assert.strictEqual(held.source, 'connected');
    assert.strictEqual(held.userId, '1020');
    assert.ok(Date.parse(out.expiresAt) > Date.now(), 'and it knows when it runs out');

    const exchange = api.calls.find((c) => c.path === '/oauth/access_token');
    assert.strictEqual(exchange.method, 'POST', 'the secret goes in a POST body, never a query string');
    assert.match(exchange.body, /code=AQBx-hBsH3\.\.\.&|code=AQBx-hBsH3/, 'and Meta’s trailing #_ is stripped');
    assert.ok(!exchange.body.includes('%23_'), 'really stripped, not just escaped');
  });
});

test('a token pasted into the environment is adopted so it can be kept alive', async () => {
  await withApi({ media: [REEL] }, async (api, env) => {
    const store = fakeStore();
    const token = await instagram.currentToken({ store, site: store.site, env });

    assert.strictEqual(token, 'tok');
    assert.strictEqual(store.site.auth.instagram.source, 'environment', 'and it is now stored, not just read');
    assert.ok(Date.parse(store.site.auth.instagram.expiresAt) > Date.now());
  });
});

test('a token near expiry renews itself; a fresh one is left alone', async () => {
  await withApi({ media: [REEL] }, async (api, env) => {
    const now = Date.now();
    const store = fakeStore({
      auth: {
        instagram: {
          token: 'old-token',
          source: 'connected',
          obtainedAt: new Date(now - 50 * 86400000).toISOString(),
          expiresAt: new Date(now + 5 * 86400000).toISOString() // inside the 10-day window
        }
      }
    });

    const token = await instagram.currentToken({ store, site: store.site, env, now });
    assert.strictEqual(token, 'refreshed-token');
    assert.strictEqual(store.site.auth.instagram.token, 'refreshed-token', 'and the new one is kept');
    assert.ok(Date.parse(store.site.auth.instagram.expiresAt) - now > 50 * 86400000, 'good for another 60 days');

    // A token with plenty of runway is not touched.
    const calm = fakeStore({
      auth: {
        instagram: {
          token: 'plenty',
          obtainedAt: new Date(now - 5 * 86400000).toISOString(),
          expiresAt: new Date(now + 55 * 86400000).toISOString()
        }
      }
    });
    const before = api.calls.length;
    assert.strictEqual(await instagram.currentToken({ store: calm, site: calm.site, env, now }), 'plenty');
    assert.strictEqual(api.calls.length, before, 'no needless call to Meta');
  });
});

test('a token younger than a day is not refreshed — Meta refuses those', async () => {
  await withApi({ media: [REEL] }, async (api, env) => {
    const now = Date.now();
    const store = fakeStore({
      auth: {
        instagram: {
          token: 'brand-new',
          obtainedAt: new Date(now - 3600 * 1000).toISOString(),
          expiresAt: new Date(now + 2 * 86400000).toISOString()
        }
      }
    });
    const before = api.calls.length;
    assert.strictEqual(await instagram.currentToken({ store, site: store.site, env, now }), 'brand-new');
    assert.strictEqual(api.calls.length, before);
  });
});

test('a refusal to refresh leaves the working token in place', async () => {
  await withApi({ media: [REEL], state: { refuseRefresh: true } }, async (api, env) => {
    const now = Date.now();
    const store = fakeStore({
      auth: {
        instagram: {
          token: 'still-good',
          obtainedAt: new Date(now - 50 * 86400000).toISOString(),
          expiresAt: new Date(now + 5 * 86400000).toISOString()
        }
      }
    });
    assert.strictEqual(await instagram.currentToken({ store, site: store.site, env, now }), 'still-good');
    assert.strictEqual(store.site.auth.instagram.token, 'still-good', 'nothing is thrown away on a failed renewal');
  });
});

test('disconnecting forgets the token', async () => {
  const store = fakeStore({ auth: { instagram: { token: 'x' } } });
  await instagram.disconnect(store);
  assert.strictEqual(store.site.auth.instagram, null);
  assert.strictEqual(instagram.status(store.site, {}).connected, false);
});

test('status never leaks the token itself', async () => {
  const store = fakeStore({
    auth: { instagram: { token: 'SECRET-TOKEN', source: 'connected', expiresAt: '2027-01-01T00:00:00.000Z' } }
  });
  const out = instagram.status(store.site, { INSTAGRAM_APP_ID: '1', INSTAGRAM_APP_SECRET: '2' });
  assert.strictEqual(out.connected, true);
  assert.strictEqual(out.canConnect, true);
  assert.ok(!JSON.stringify(out).includes('SECRET-TOKEN'), 'the panel is told the state, never the secret');
});

test('the authorize URL asks for the documented scope and comes back to /admin', () => {
  const url = new URL(instagram.authorizeUrl('https://www.taylordrew4u.com', { INSTAGRAM_APP_ID: '990602627938098' }));
  assert.strictEqual(url.origin + url.pathname, 'https://www.instagram.com/oauth/authorize');
  assert.strictEqual(url.searchParams.get('client_id'), '990602627938098');
  assert.strictEqual(url.searchParams.get('response_type'), 'code');
  assert.strictEqual(url.searchParams.get('scope'), 'instagram_business_basic');
  assert.strictEqual(url.searchParams.get('redirect_uri'), 'https://www.taylordrew4u.com/admin');
  assert.strictEqual(instagram.authorizeUrl('https://x.com', {}), '', 'and nothing without an app ID');
});

// ------------------------------------------------- the one-paste feed URL

const http = require('node:http');

async function serveFeed(payload, { status = 200 } = {}) {
  const server = http.createServer((req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/feed.json`, stop: () => new Promise((r) => server.close(r)) };
}

test('one pasted feed URL is the whole setup', async () => {
  instagram.resetCache();
  const feed = await serveFeed([
    {
      id: 'abc',
      mediaType: 'VIDEO',
      mediaUrl: 'https://cdn.example/a.mp4',
      thumbnailUrl: 'https://cdn.example/a.jpg',
      permalink: 'https://www.instagram.com/reel/AAA/',
      caption: 'Crowd work at the Cellar #comedy #nyc'
    },
    { id: 'pic', mediaType: 'IMAGE', imageUrl: 'https://cdn.example/p.jpg', permalink: 'https://www.instagram.com/p/P/' }
  ]);

  try {
    const out = await instagram.fetchFeedUrl(feed.url);
    assert.strictEqual(out.configured, true);
    assert.strictEqual(out.error, null);
    assert.strictEqual(out.reels.length, 1, 'the photo is not a reel');
    assert.deepStrictEqual(out.reels[0], {
      id: 'ig-abc',
      url: 'https://www.instagram.com/reel/AAA/',
      video: 'https://cdn.example/a.mp4',
      poster: 'https://cdn.example/a.jpg',
      caption: 'Crowd work at the Cellar',
      visible: true,
      source: 'instagram'
    });
  } finally {
    await feed.stop();
    instagram.resetCache();
  }
});

test('a feed wrapped in an envelope works too', async () => {
  instagram.resetCache();
  const feed = await serveFeed({
    data: [{ id: '1', media_type: 'VIDEO', media_url: 'https://cdn.example/x.mp4', permalink: 'https://ig/reel/X/' }]
  });
  try {
    const out = await instagram.fetchFeedUrl(feed.url);
    assert.strictEqual(out.reels.length, 1);
    assert.strictEqual(out.reels[0].video, 'https://cdn.example/x.mp4');
  } finally {
    await feed.stop();
    instagram.resetCache();
  }
});

test('a feed that breaks says so rather than showing a blank wall', async () => {
  instagram.resetCache();
  const dead = await serveFeed({ error: 'nope' }, { status: 500 });
  try {
    const out = await instagram.fetchFeedUrl(dead.url);
    assert.deepStrictEqual(out.reels, []);
    assert.match(out.error, /answered 500/);
  } finally {
    await dead.stop();
  }

  instagram.resetCache();
  const odd = await serveFeed([{ id: 'z', somethingElse: true }]);
  try {
    const out = await instagram.fetchFeedUrl(odd.url);
    assert.match(out.error, /none looked like reels/, 'an unrecognised shape is named, not silently empty');
  } finally {
    await odd.stop();
    instagram.resetCache();
  }
});

test('no feed URL means simply not configured', async () => {
  instagram.resetCache();
  assert.deepStrictEqual(await instagram.fetchFeedUrl(''), { reels: [], configured: false, error: null });
});

test('pasting the Instagram page itself is named, not left as a vague failure', async () => {
  instagram.resetCache();
  const out = await instagram.fetchFeedUrl('https://www.instagram.com/taylordrew4u/reels/');
  assert.strictEqual(out.configured, true, 'something was set, it is just the wrong thing');
  assert.deepStrictEqual(out.reels, []);
  assert.match(out.error, /your Instagram page, not a feed/);
  assert.match(out.error, /behold\.so/, 'and it says where to get the right one');

  assert.match(instagram.feedUrlProblem('https://instagram.com/x'), /not a feed/);
  assert.match(instagram.feedUrlProblem('nonsense'), /does not look like a URL/);
  assert.strictEqual(instagram.feedUrlProblem('https://feeds.behold.so/abc'), '', 'a real feed URL passes');
});

test('the feed reader is not a bet on one vendor', () => {
  const cases = {
    'bare array': [{ id: '1', media_type: 'VIDEO', media_url: 'https://c/a.mp4', permalink: 'https://ig/reel/A/' }],
    'data envelope': { data: [{ id: '2', mediaType: 'VIDEO', mediaUrl: 'https://c/b.mp4', permalink: 'https://ig/reel/B/' }] },
    'nested posts.items': {
      posts: { items: [{ id: '3', video: 'https://c/c.mp4', full_url: 'https://ig/reel/C/', message: 'Set #comedy', image: 'https://c/c.jpg' }] }
    },
    'posts array + text': { posts: [{ id: '4', type: 'video', video: 'https://c/d.mp4', url: 'https://ig/reel/D/', text: 'Roast' }] }
  };
  for (const [name, body] of Object.entries(cases)) {
    const reels = instagram.feedItems(body).map(instagram.reelFromFeedItem).filter(Boolean);
    assert.strictEqual(reels.length, 1, `${name}: one reel`);
    assert.match(reels[0].video, /\.mp4$/, `${name}: the video is found`);
  }

  assert.strictEqual(instagram.feedItems({ meta: { ok: true } }).length, 0, 'junk yields nothing rather than a guess');
  assert.strictEqual(instagram.feedItems(null).length, 0);
  assert.strictEqual(
    instagram.feedItems({ posts: { items: [{ id: '3', message: 'Set' }] } }).length,
    1,
    'nesting is found even when the post itself is thin'
  );

  // Captions come from whichever field the service used.
  assert.strictEqual(instagram.reelFromFeedItem({ id: 'x', video: 'https://c/x.mp4', message: 'Crowd work #nyc' }).caption, 'Crowd work');
  assert.strictEqual(instagram.reelFromFeedItem({ id: 'y', video: 'https://c/y.mp4', text: 'Cellar' }).caption, 'Cellar');
});
