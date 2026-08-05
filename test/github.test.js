'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createGithubBackend, createBackend, detectGithubConfig } = require('../lib/storage');
const { defaultSite } = require('../lib/defaults');
const { startFakeGithub } = require('./helpers/fake-github');

async function withBackend(run, options = {}) {
  const gh = await startFakeGithub();
  const backend = createGithubBackend({
    token: gh.token,
    owner: gh.owner,
    repo: gh.repo,
    branch: 'main',
    contentPath: 'data/site.json',
    uploadDir: 'data/uploads',
    apiBase: gh.api,
    cacheMs: 0, // no caching, so each assertion sees the truth
    ...options
  });
  try {
    await run(backend, gh);
  } finally {
    await gh.close();
  }
}

test('the site document round-trips through the repository', async () => {
  await withBackend(async (backend, gh) => {
    assert.strictEqual(await backend.readSiteDoc(), null, 'an empty repo has no content yet');

    const doc = defaultSite();
    doc.brand.name = 'Committed';
    await backend.writeSiteDoc(doc);

    assert.ok(gh.files.has('data/site.json'), 'the file lands in the repo');
    assert.strictEqual((await backend.readSiteDoc()).brand.name, 'Committed');

    doc.brand.name = 'Committed twice';
    await backend.writeSiteDoc(doc);
    assert.strictEqual((await backend.readSiteDoc()).brand.name, 'Committed twice');
  });
});

test('stored content is readable JSON in the repo, not an opaque blob', async () => {
  await withBackend(async (backend, gh) => {
    const doc = defaultSite();
    doc.brand.name = 'Readable';
    await backend.writeSiteDoc(doc);

    const raw = gh.files.get('data/site.json').buffer.toString('utf8');
    assert.match(raw, /\n {2}"brand"/, 'pretty-printed so diffs are reviewable');
    assert.strictEqual(JSON.parse(raw).brand.name, 'Readable');
  });
});

test('every save is a commit, and any of them can be restored', async () => {
  await withBackend(async (backend) => {
    const doc = defaultSite();
    for (const name of ['First', 'Second', 'Third']) {
      doc.brand.name = name;
      await backend.writeSiteDoc(doc);
    }

    const backups = await backend.listBackups();
    assert.ok(backups.length >= 2, 'history minus the current version');
    assert.match(backups[0].name, /^site-[0-9a-f]{7,40}\.json$/);
    assert.ok(backups[0].createdAt, 'commits carry a date');

    const previous = await backend.readBackup(backups[0].name);
    assert.strictEqual(previous.brand.name, 'Second', 'the version before the newest');
  });
});

test('a bogus snapshot reference is refused rather than fetched', async () => {
  await withBackend(async (backend) => {
    await assert.rejects(() => backend.readBackup('site-../../etc/passwd.json'), /Invalid snapshot reference/);
    await assert.rejects(() => backend.readBackup('site-nonsense.json'), /Invalid snapshot reference/);
  });
});

test('images are committed, listed, served and deleted', async () => {
  await withBackend(async (backend, gh) => {
    const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
    const stored = await backend.putImage('shot-abc.png', bytes, 'image/png');
    assert.strictEqual(stored.url, '/uploads/shot-abc.png');
    assert.ok(gh.files.has('data/uploads/shot-abc.png'));

    const listed = await backend.listImages();
    assert.deepStrictEqual(listed.map((f) => f.name), ['shot-abc.png']);

    const read = await backend.readImage('shot-abc.png');
    assert.ok(read.buffer.equals(bytes), 'bytes survive the base64 round trip');
    assert.strictEqual(read.contentType, 'image/png');

    await backend.deleteImage('shot-abc.png');
    assert.deepStrictEqual(await backend.listImages(), []);
    assert.strictEqual(await backend.readImage('shot-abc.png'), null);
  });
});

test('images too large for the Contents API are refused with the reason', async () => {
  await withBackend(async (backend) => {
    await assert.rejects(
      () => backend.putImage('huge.png', Buffer.alloc(backend.maxImageBytes + 1), 'image/png'),
      /have to stay under/
    );
  });
});

test('an empty uploads directory lists as empty rather than failing', async () => {
  await withBackend(async (backend) => {
    assert.deepStrictEqual(await backend.listImages(), []);
  });
});

test('a bad token is reported as a credentials problem', async () => {
  const gh = await startFakeGithub();
  const backend = createGithubBackend({
    token: 'wrong-token',
    owner: gh.owner,
    repo: gh.repo,
    branch: 'main',
    contentPath: 'data/site.json',
    uploadDir: 'data/uploads',
    apiBase: gh.api,
    cacheMs: 0
  });

  await assert.rejects(() => backend.readSiteDoc(), /GITHUB_TOKEN is valid and has Contents: read and write/);
  await gh.close();
});

test('malformed content in the repo names the file', async () => {
  await withBackend(async (backend, gh) => {
    gh.files.set('data/site.json', { buffer: Buffer.from('{ oops'), sha: 'x' });
    await assert.rejects(() => backend.readSiteDoc(), /is not valid JSON/);
  });
});

test('reads are cached briefly so a page view is not a round trip', async () => {
  await withBackend(
    async (backend, gh) => {
      const doc = defaultSite();
      doc.brand.name = 'Cached';
      await backend.writeSiteDoc(doc);

      // Change the repo behind the backend's back.
      gh.files.set('data/site.json', {
        buffer: Buffer.from(JSON.stringify({ ...doc, brand: { ...doc.brand, name: 'Changed elsewhere' } })),
        sha: 'other'
      });

      assert.strictEqual((await backend.readSiteDoc()).brand.name, 'Cached', 'served from cache');
    },
    { cacheMs: 60000 }
  );
});

test('a write is visible immediately despite the cache', async () => {
  await withBackend(
    async (backend) => {
      const doc = defaultSite();
      doc.brand.name = 'Before';
      await backend.writeSiteDoc(doc);
      assert.strictEqual((await backend.readSiteDoc()).brand.name, 'Before');

      doc.brand.name = 'After';
      await backend.writeSiteDoc(doc);
      assert.strictEqual((await backend.readSiteDoc()).brand.name, 'After', 'the cache is refreshed on write');
    },
    { cacheMs: 60000 }
  );
});

test('clicks are counted in memory and merged on read', async () => {
  await withBackend(async (backend) => {
    const doc = defaultSite();
    doc.links.items = [{ id: 'link-a', label: 'A', url: 'https://a.example', visible: true, featured: false, clicks: 3 }];
    await backend.writeSiteDoc(doc);

    await backend.bumpClick('link-a');
    await backend.bumpClick('link-a');

    const merged = await backend.applyClicks(await backend.readSiteDoc());
    assert.strictEqual(merged.links.items[0].clicks, 5, 'stored count plus this instance');
  });
});

test('the backend declares that it cannot hold sessions', async () => {
  await withBackend(async (backend) => {
    assert.strictEqual(backend.statelessSessions, true);
  });
});

test('the repository is discovered from the environment', () => {
  const fromVercel = detectGithubConfig({
    GITHUB_TOKEN: 't',
    VERCEL_GIT_REPO_OWNER: 'taylordrew4u2',
    VERCEL_GIT_REPO_SLUG: 'taylosite',
    VERCEL_GIT_COMMIT_REF: 'main'
  });
  assert.strictEqual(fromVercel.owner, 'taylordrew4u2');
  assert.strictEqual(fromVercel.repo, 'taylosite');
  assert.strictEqual(fromVercel.branch, 'main');

  const explicit = detectGithubConfig({ GH_TOKEN: 't', GITHUB_REPO: 'someone/else', GITHUB_BRANCH: 'live' });
  assert.strictEqual(explicit.owner, 'someone');
  assert.strictEqual(explicit.repo, 'else');
  assert.strictEqual(explicit.branch, 'live');
});

test('a token without a repository is called out', () => {
  assert.throws(() => createBackend({ VERCEL: '1', GITHUB_TOKEN: 't' }), /GITHUB_REPO in the form owner\/name/);
});

test('Redis wins when both are configured, GitHub is the fallback', () => {
  const both = createBackend({
    VERCEL: '1',
    KV_REST_API_URL: 'https://x.upstash.io',
    KV_REST_API_TOKEN: 'k',
    GITHUB_TOKEN: 't',
    GITHUB_REPO: 'a/b'
  });
  assert.strictEqual(both.name, 'serverless');

  const githubOnly = createBackend({ VERCEL: '1', GITHUB_TOKEN: 't', GITHUB_REPO: 'a/b' });
  assert.strictEqual(githubOnly.name, 'github');
});

test('with neither configured on Vercel, both options are offered', () => {
  assert.throws(() => createBackend({ VERCEL: '1' }), /GITHUB_TOKEN/);
  assert.throws(() => createBackend({ VERCEL: '1' }), /Redis/);
});
