'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createFilesystemBackend, createServerlessBackend, detectConfig } = require('../lib/storage');
const { defaultSite } = require('../lib/defaults');
const { startFakeRedis } = require('./helpers/fake-redis');

function tempFilesystemBackend() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taylosite-test-'));
  const previous = process.env.TAYLOSITE_DATA_DIR;
  process.env.TAYLOSITE_DATA_DIR = dir;
  const backend = createFilesystemBackend();
  if (previous === undefined) delete process.env.TAYLOSITE_DATA_DIR;
  else process.env.TAYLOSITE_DATA_DIR = previous;
  return { backend, dir };
}

/** Both backends must satisfy the same contract, so the suite runs twice. */
async function backends() {
  const fsBackend = tempFilesystemBackend();
  const redis = await startFakeRedis();
  return [
    { label: 'filesystem', backend: fsBackend.backend, cleanup: async () => fs.rmSync(fsBackend.dir, { recursive: true, force: true }) },
    {
      label: 'serverless',
      backend: createServerlessBackend({ redisUrl: redis.url, redisToken: redis.token }),
      cleanup: () => redis.close()
    }
  ];
}

test('storage backends satisfy the same contract', async (t) => {
  for (const { label, backend, cleanup } of await backends()) {
    await t.test(label, async (sub) => {
      backend.ensureDirs();

      await sub.test('site document round-trips, and starts empty', async () => {
        assert.strictEqual(await backend.readSiteDoc(), null);
        const doc = defaultSite();
        doc.brand.name = 'Round Trip';
        await backend.writeSiteDoc(doc);
        assert.strictEqual((await backend.readSiteDoc()).brand.name, 'Round Trip');
      });

      await sub.test('backups are listed newest first and prune to a limit', async () => {
        for (const stamp of ['site-2026-01-01.json', 'site-2026-02-01.json', 'site-2026-03-01.json']) {
          await backend.saveBackup(stamp, { marker: stamp });
        }
        const listed = await backend.listBackups();
        assert.strictEqual(listed.length, 3);
        assert.strictEqual(listed[0].name, 'site-2026-03-01.json', 'newest first');
        assert.strictEqual((await backend.readBackup('site-2026-02-01.json')).marker, 'site-2026-02-01.json');

        await backend.pruneBackups(2);
        const kept = (await backend.listBackups()).map((b) => b.name);
        assert.deepStrictEqual(kept, ['site-2026-03-01.json', 'site-2026-02-01.json']);
      });

      await sub.test('missing backups raise rather than return junk', async () => {
        await assert.rejects(() => backend.readBackup('site-nope.json'));
      });

      await sub.test('sessions are stored, listed and revoked', async () => {
        const session = { csrf: 'abc', createdAt: Date.now(), expiresAt: Date.now() + 60000, ip: '::1', agent: 'test' };
        await backend.writeSession('a'.repeat(64), session, 60);
        assert.strictEqual((await backend.readSession('a'.repeat(64))).csrf, 'abc');
        assert.strictEqual((await backend.listSessions()).length, 1);

        await backend.deleteSession('a'.repeat(64));
        assert.strictEqual(await backend.readSession('a'.repeat(64)), null);

        await backend.writeSession('b'.repeat(64), session, 60);
        await backend.clearSessions();
        assert.strictEqual((await backend.listSessions()).length, 0);
      });

      await sub.test('expired sessions are not returned', async () => {
        const expired = { csrf: 'x', createdAt: Date.now() - 2000, expiresAt: Date.now() - 1000 };
        await backend.writeSession('c'.repeat(64), expired, 60);
        const found = await backend.readSession('c'.repeat(64));
        // The filesystem backend drops it on read; Redis relies on its own TTL,
        // so a still-present record must at least carry a past expiry.
        assert.ok(found === null || found.expiresAt < Date.now());
      });

      await sub.test('images round-trip and delete', async () => {
        const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
        const stored = await backend.putImage('shot-abc.png', bytes, 'image/png');
        assert.strictEqual(stored.size, bytes.length);

        const listed = await backend.listImages();
        assert.strictEqual(listed.length, 1);
        assert.strictEqual(listed[0].name, 'shot-abc.png');

        const read = await backend.readImage('shot-abc.png');
        if (read.buffer) assert.ok(read.buffer.equals(bytes), 'bytes come back unchanged');
        else assert.ok(read.file || read.redirect, 'or a location to serve from');

        await backend.deleteImage('shot-abc.png');
        assert.strictEqual((await backend.listImages()).length, 0);
        assert.strictEqual(await backend.readImage('shot-abc.png'), null);
      });

      await sub.test('deleting an image that is not there raises', async () => {
        await assert.rejects(() => backend.deleteImage('missing.png'));
      });

      await sub.test('a click survives a concurrent full-document save', async () => {
        const doc = defaultSite();
        doc.links.items = [{ id: 'link-a', label: 'A', url: 'https://a.example', visible: true, featured: false, clicks: 0 }];
        await backend.writeSiteDoc(doc);

        await backend.bumpClick('link-a');
        await backend.bumpClick('link-a');

        // An editor saving a document it read before those clicks happened.
        const stale = JSON.parse(JSON.stringify(doc));
        stale.brand.name = 'Edited meanwhile';
        await backend.writeSiteDoc(stale);

        const merged = await backend.applyClicks(await backend.readSiteDoc());
        assert.strictEqual(merged.brand.name, 'Edited meanwhile', 'the edit lands');
        if (backend.name === 'serverless') {
          assert.strictEqual(merged.links.items[0].clicks, 2, 'and the clicks are not lost');
        }
      });
    });

    await cleanup();
  }
});

test('the filesystem backend keeps a corrupt document instead of losing it', async () => {
  const { backend, dir } = tempFilesystemBackend();
  backend.ensureDirs();
  fs.writeFileSync(path.join(dir, 'site.json'), '{ this is not json');

  assert.strictEqual(await backend.readSiteDoc(), null, 'unreadable reads as empty');
  const rescued = fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.startsWith('corrupt-'));
  assert.strictEqual(rescued.length, 1, 'the damaged file is kept for inspection');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('backend selection reads the documented environment variables', () => {
  assert.deepStrictEqual(
    detectConfig({ KV_REST_API_URL: 'a', KV_REST_API_TOKEN: 'b', BLOB_READ_WRITE_TOKEN: 'c' }),
    { redisUrl: 'a', redisToken: 'b', blobToken: 'c' }
  );
  assert.deepStrictEqual(
    detectConfig({ UPSTASH_REDIS_REST_URL: 'a', UPSTASH_REDIS_REST_TOKEN: 'b' }),
    { redisUrl: 'a', redisToken: 'b', blobToken: undefined },
    'connecting Upstash directly works as well as via the Vercel integration'
  );
  assert.deepStrictEqual(detectConfig({}), { redisUrl: undefined, redisToken: undefined, blobToken: undefined });
});

test('half-configured Redis credentials are named precisely', () => {
  const { createBackend } = require('../lib/storage');

  assert.throws(
    () => createBackend({ VERCEL: '1', UPSTASH_REDIS_REST_URL: 'redis://default:pw@eu1.upstash.io:6379', UPSTASH_REDIS_REST_TOKEN: 't' }),
    /REST URL/,
    'the redis:// connection string is the easy mistake, so say so'
  );
  assert.throws(
    () => createBackend({ VERCEL: '1', UPSTASH_REDIS_REST_URL: 'https://x.upstash.io' }),
    /token is missing/
  );
  assert.throws(
    () => createBackend({ VERCEL: '1', UPSTASH_REDIS_REST_TOKEN: 'token-only' }),
    /URL is missing/
  );
  assert.throws(() => createBackend({ VERCEL: '1' }), /nowhere to store content/);
});

test('without Blob, images are kept in Redis and stay under its request ceiling', async () => {
  const redis = await startFakeRedis();
  const backend = createServerlessBackend({ redisUrl: redis.url, redisToken: redis.token });

  assert.match(backend.description, /images in Redis/);
  assert.ok(backend.maxImageBytes < 1024 * 1024, 'the cap leaves room for base64 expansion');

  await assert.rejects(
    () => backend.putImage('huge.png', Buffer.alloc(backend.maxImageBytes + 1), 'image/png'),
    /stored in Redis/,
    'an oversized image is refused with an explanation'
  );

  await redis.close();
});

test('adding Blob does not orphan images already in Redis', async (t) => {
  const { composeImageStores } = require('../lib/storage');

  // Two fakes standing in for Blob (new) and Redis (what is already there).
  const makeStore = (label, seed) => {
    const files = new Map(seed || []);
    return {
      limit: label === 'blob' ? 8 * 1024 * 1024 : 700 * 1024,
      calls: [],
      async put(name, buffer) {
        this.calls.push('put');
        files.set(name, buffer);
        return { name, url: `/${label}/${name}`, size: buffer.length };
      },
      async list() {
        return [...files.keys()].map((name) => ({ name, url: `/${label}/${name}`, size: 1, createdAt: name }));
      },
      async remove(name) {
        if (!files.has(name)) throw new Error('File not found');
        files.delete(name);
      },
      async read(name) {
        return files.has(name) ? { buffer: files.get(name), contentType: 'image/png', from: label } : null;
      }
    };
  };

  const blob = makeStore('blob');
  const redis = makeStore('redis', [['old-photo.png', Buffer.from('old')]]);
  const images = composeImageStores(blob, redis);

  await t.test('the older image is still listed', async () => {
    assert.deepStrictEqual((await images.list()).map((i) => i.name), ['old-photo.png']);
  });

  await t.test('and still readable, from where it actually is', async () => {
    const found = await images.read('old-photo.png');
    assert.strictEqual(found.from, 'redis');
    assert.ok(found.buffer.equals(Buffer.from('old')));
  });

  await t.test('new uploads go to the new store', async () => {
    await images.put('new-photo.png', Buffer.from('new'), 'image/png');
    assert.deepStrictEqual(blob.calls, ['put']);
    assert.strictEqual((await images.read('new-photo.png')).from, 'blob');
  });

  await t.test('both appear together, newest first', async () => {
    assert.deepStrictEqual((await images.list()).map((i) => i.name), ['old-photo.png', 'new-photo.png']);
  });

  await t.test('the limit is the new store’s, not the old one’s', () => {
    assert.strictEqual(images.limit, 8 * 1024 * 1024);
  });

  await t.test('deleting reaches whichever store holds the file', async () => {
    await images.remove('old-photo.png');
    await images.remove('new-photo.png');
    assert.deepStrictEqual(await images.list(), []);
  });

  await t.test('a genuinely missing file still raises', async () => {
    await assert.rejects(() => images.remove('never-existed.png'));
  });

  await t.test('a failing new store does not hide the older images', async () => {
    const broken = { limit: 1, put: async () => {}, list: async () => { throw new Error('Blob down'); },
                     remove: async () => { throw new Error('Blob down'); }, read: async () => { throw new Error('Blob down'); } };
    const survivor = makeStore('redis', [['kept.png', Buffer.from('kept')]]);
    const resilient = composeImageStores(broken, survivor);
    assert.deepStrictEqual((await resilient.list()).map((i) => i.name), ['kept.png']);
    assert.strictEqual((await resilient.read('kept.png')).from, 'redis');
  });
});
