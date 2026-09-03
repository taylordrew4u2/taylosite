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

async function withApi(opts, fn) {
  const api = await startFakeInstagram(opts);
  instagram.resetCache();
  try {
    return await fn(api, { INSTAGRAM_TOKEN: 'tok', INSTAGRAM_API_BASE: api.base });
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
