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
