'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const indexnow = require('../lib/indexnow');

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

test('a key is minted once and then reused', async () => {
  const store = fakeStore();
  const first = await indexnow.ensureKey(store, store.site);
  assert.match(first, /^[a-f0-9]{32}$/);

  const second = await indexnow.ensureKey(store, await store.readSite());
  assert.strictEqual(second, first, 'a new key every save would invalidate the file already published');
});

test('only the real key file answers', () => {
  const key = 'a1b2c3d4e5f60718';
  assert.strictEqual(indexnow.keyFileFor(`/${key}.txt`, key), true);
  assert.strictEqual(indexnow.keyFileFor('/deadbeefdeadbeef.txt', key), false, 'a guess proves nothing');
  assert.strictEqual(indexnow.keyFileFor(`/${key}.txt`, ''), false, 'and no key means no proof to give');
});

test('the submission says which host, which key, and where the key lives', async () => {
  const seen = [];
  const engine = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, type: req.headers['content-type'], body: JSON.parse(body) });
      res.writeHead(200).end();
    });
  });
  await new Promise((r) => engine.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${engine.address().port}/IndexNow`;

  try {
    const out = await indexnow.submit({
      origin: 'https://www.taylordrew4u.com',
      key: 'a1b2c3d4e5f60718',
      urls: indexnow.siteUrls('https://www.taylordrew4u.com'),
      endpoint
    });

    assert.strictEqual(out.ok, true);
    assert.strictEqual(seen[0].method, 'POST');
    assert.match(seen[0].type, /application\/json/);
    assert.deepStrictEqual(seen[0].body.host, 'www.taylordrew4u.com');
    assert.strictEqual(
      seen[0].body.keyLocation,
      'https://www.taylordrew4u.com/a1b2c3d4e5f60718.txt',
      'the engine has to be told where to check'
    );
    assert.ok(seen[0].body.urlList.includes('https://www.taylordrew4u.com/reels'));
  } finally {
    await new Promise((r) => engine.close(r));
  }
});

test('a search engine being down is not an error worth raising', async () => {
  const out = await indexnow.submit({
    origin: 'https://www.taylordrew4u.com',
    key: 'a1b2c3d4e5f60718',
    urls: ['https://www.taylordrew4u.com/'],
    endpoint: 'http://127.0.0.1:1/IndexNow',
    timeoutMs: 300
  });
  assert.strictEqual(out.ok, false, 'reported, not thrown — the save already succeeded');
});

test('nothing is sent without a key or a URL to send', async () => {
  assert.strictEqual((await indexnow.submit({ origin: 'https://x.com', key: '', urls: ['/'] })).skipped, true);
  assert.strictEqual((await indexnow.submit({ origin: 'https://x.com', key: 'ab', urls: [] })).skipped, true);
});
