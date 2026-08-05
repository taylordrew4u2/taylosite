'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { startFakeRedis } = require('./helpers/fake-redis');
const { startFakeGithub } = require('./helpers/fake-github');

const ROOT = path.join(__dirname, '..');
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050001a5f645b40000000049454e44ae426082',
  'hex'
);

/** Boot the real server as a child process and wait for it to answer. */
async function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taylosite-srv-'));
  // A null value removes an inherited variable — this machine may well have a
  // GITHUB_TOKEN of its own, which some cases need absent.
  const childEnv = { ...process.env, PORT: '0', TAYLOSITE_DATA_DIR: dir, ...env };
  for (const [key, value] of Object.entries(childEnv)) {
    if (value === null) delete childEnv[key];
  }
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 15000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = /http:\/\/localhost:(\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}:\n${output}`));
    });
  });

  const base = `http://127.0.0.1:${port}`;
  const jar = { cookie: '', csrf: null };

  async function call(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (jar.cookie) headers.cookie = jar.cookie;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.csrf !== false && jar.csrf) headers['x-csrf-token'] = jar.csrf;

    const res = await fetch(base + pathname, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'manual'
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) jar.cookie = setCookie.split(';')[0];
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      /* not every response is JSON */
    }
    return { status: res.status, headers: res.headers, text, json };
  }

  return {
    base,
    call,
    async login(password = 'weed') {
      const res = await call('/api/login', { method: 'POST', body: { password } });
      if (res.json && res.json.csrf) jar.csrf = res.json.csrf;
      return res;
    },
    forgetCsrf() {
      jar.csrf = null;
    },
    async stop() {
      child.kill('SIGKILL');
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function withServer(env, run) {
  const server = await startServer(env);
  try {
    await run(server);
  } finally {
    await server.stop();
  }
}

test('public pages render', async () => {
  await withServer({}, async (server) => {
    for (const page of ['/', '/about', '/links']) {
      const res = await server.call(page);
      assert.strictEqual(res.status, 200, `${page} responds`);
      assert.match(res.text, /TAYLOR DREW|Taylor Drew/i);
    }
    assert.strictEqual((await server.call('/admin')).status, 200);
    assert.strictEqual((await server.call('/robots.txt')).status, 200);
    assert.match((await server.call('/sitemap.xml')).text, /<urlset/);
    assert.strictEqual((await server.call('/nope')).status, 404);
  });
});

test('content is escaped on the way out', async () => {
  await withServer({}, async (server) => {
    await server.login();
    const payload = '<script>alert(1)</script>';
    await server.call('/api/admin/site', { method: 'PUT', body: { site: { home: { subhead: payload } } } });

    const res = await server.call('/');
    assert.ok(!res.text.includes(payload), 'the raw tag never reaches the page');
    assert.match(res.text, /&lt;script&gt;/);
  });
});

test('structured data is valid JSON and covers upcoming shows', async () => {
  await withServer({}, async (server) => {
    await server.login();
    await server.call('/api/admin/site', {
      method: 'PUT',
      body: { site: { shows: [{ id: 's1', date: '2099-05-01', venue: 'The Venue', city: 'New York, NY', visible: true }] } }
    });

    const html = (await server.call('/')).text;
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
      JSON.parse(m[1])
    );
    assert.ok(blocks.length >= 2, 'a Person plus an Event');
    assert.strictEqual(blocks[0]['@type'], 'Person');
    assert.ok(blocks.some((b) => b['@type'] === 'Event' && b.startDate === '2099-05-01'));
  });
});

test('the admin API refuses unauthenticated and CSRF-less writes', async () => {
  await withServer({}, async (server) => {
    assert.strictEqual((await server.call('/api/admin/site')).status, 401);

    await server.login();
    assert.strictEqual((await server.call('/api/admin/site')).status, 200);

    server.forgetCsrf();
    const res = await server.call('/api/admin/site', { method: 'PUT', body: { site: {} }, csrf: false });
    assert.strictEqual(res.status, 403, 'a cookie alone is not enough to write');
  });
});

test('the wrong password is rejected and the right one signs in', async () => {
  await withServer({}, async (server) => {
    assert.strictEqual((await server.login('not-the-password')).status, 401);
    assert.strictEqual((await server.login('weed')).status, 200);
    assert.strictEqual((await server.call('/api/session')).json.signedIn, true);

    await server.call('/api/logout', { method: 'POST' });
    assert.strictEqual((await server.call('/api/session')).json.signedIn, false);
  });
});

test('ADMIN_PASSWORD seeds the password when set', async () => {
  await withServer({ ADMIN_PASSWORD: 'correct-horse' }, async (server) => {
    assert.strictEqual((await server.login('weed')).status, 401);
    assert.strictEqual((await server.login('correct-horse')).status, 200);
  });
});

test('repeated wrong guesses lock the caller out', async () => {
  await withServer({}, async (server) => {
    let locked = null;
    for (let i = 0; i < 12 && !locked; i++) {
      const res = await server.login('wrong');
      if (res.status === 429) locked = res;
    }
    assert.ok(locked, 'a lockout eventually kicks in');
    assert.match(locked.json.error, /Too many attempts/);
  });
});

test('uploads are validated, stored and served', async () => {
  await withServer({}, async (server) => {
    await server.login();

    const bad = await server.call('/api/admin/uploads', {
      method: 'POST',
      body: { name: 'x.exe', dataUrl: 'data:application/x-msdownload;base64,AAAA' }
    });
    assert.strictEqual(bad.status, 415, 'only images are accepted');

    const notADataUrl = await server.call('/api/admin/uploads', {
      method: 'POST',
      body: { name: 'x.png', dataUrl: 'https://example.com/x.png' }
    });
    assert.strictEqual(notADataUrl.status, 400);

    const good = await server.call('/api/admin/uploads', {
      method: 'POST',
      body: { name: 'Head Shot!.png', dataUrl: `data:image/png;base64,${PNG.toString('base64')}` }
    });
    assert.strictEqual(good.status, 201);
    assert.match(good.json.file.name, /^head-shot-[0-9a-f]{8}\.png$/, 'the name is sanitised and made unique');

    const served = await server.call(good.json.file.url);
    assert.strictEqual(served.status, 200);
    assert.strictEqual(served.headers.get('content-type'), 'image/png');

    const listed = await server.call('/api/admin/uploads');
    assert.strictEqual(listed.json.files.length, 1);

    await server.call(`/api/admin/uploads/${good.json.file.name}`, { method: 'DELETE' });
    assert.strictEqual((await server.call('/api/admin/uploads')).json.files.length, 0);
    assert.strictEqual((await server.call(good.json.file.url)).status, 404);
  });
});

test('upload paths cannot escape the store', async () => {
  await withServer({}, async (server) => {
    for (const attempt of ['/uploads/..%2f..%2fserver.js', '/uploads/../../package.json', '/assets/../../server.js']) {
      const res = await server.call(attempt);
      assert.strictEqual(res.status, 404, `${attempt} is refused`);
      assert.ok(!res.text.includes('createServer'), 'no source code leaks');
    }
  });
});

test('following a link counts the click and redirects', async () => {
  await withServer({}, async (server) => {
    const before = (await server.call('/api/content')).json.links.items[0];
    const res = await server.call(`/go/${before.id}`);
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), before.url);

    const after = (await server.call('/api/content')).json.links.items[0];
    assert.strictEqual(after.clicks, before.clicks + 1);

    assert.strictEqual((await server.call('/go/does-not-exist')).status, 404);
  });
});

test('saving against a stale copy is refused', async () => {
  await withServer({}, async (server) => {
    await server.login();
    const res = await server.call('/api/admin/site', {
      method: 'PUT',
      body: { site: { brand: { name: 'Second writer' } }, expectedUpdatedAt: '1999-01-01T00:00:00.000Z' }
    });
    assert.strictEqual(res.status, 409);
    assert.match(res.json.error, /changed in another tab/);
  });
});

test('snapshots are taken on save and can be restored', async () => {
  await withServer({}, async (server) => {
    await server.login();
    await server.call('/api/admin/site', { method: 'PUT', body: { site: { brand: { name: 'First' } } } });
    await server.call('/api/admin/site', { method: 'PUT', body: { site: { brand: { name: 'Second' } } } });

    const backups = (await server.call('/api/admin/backups')).json.backups;
    assert.ok(backups.length >= 2);

    const restored = await server.call('/api/admin/backups/restore', { method: 'POST', body: { name: backups[0].name } });
    assert.strictEqual(restored.status, 200);
    assert.strictEqual(restored.json.site.brand.name, 'First', 'the previous version comes back');
  });
});

test('a restore cannot roll the password back', async () => {
  await withServer({}, async (server) => {
    await server.login();
    await server.call('/api/admin/site', { method: 'PUT', body: { site: { brand: { name: 'Snapshot me' } } } });
    const backups = (await server.call('/api/admin/backups')).json.backups;

    await server.call('/api/admin/password', { method: 'POST', body: { current: 'weed', next: 'new-password' } });

    const fresh = await startServerSession(server);
    await fresh.login('new-password');
    await fresh.call('/api/admin/backups/restore', { method: 'POST', body: { name: backups[0].name } });

    assert.strictEqual((await fresh.login('weed')).status, 401, 'the old password stays dead');
    assert.strictEqual((await fresh.login('new-password')).status, 200);
  });

  // Restoring runs on the same server; this just gives us a clean cookie jar.
  function startServerSession(server) {
    const jar = { cookie: '', csrf: null };
    async function call(pathname, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (jar.cookie) headers.cookie = jar.cookie;
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      if (jar.csrf) headers['x-csrf-token'] = jar.csrf;
      const res = await fetch(server.base + pathname, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: 'manual'
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) jar.cookie = setCookie.split(';')[0];
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_) {
        /* not JSON */
      }
      return { status: res.status, headers: res.headers, text, json };
    }
    return {
      call,
      async login(password) {
        const res = await call('/api/login', { method: 'POST', body: { password } });
        if (res.json && res.json.csrf) jar.csrf = res.json.csrf;
        return res;
      }
    };
  }
});

test('an oversized body gets a 413 rather than a dropped connection', async () => {
  await withServer({}, async (server) => {
    await server.login();
    const res = await server.call('/api/admin/uploads', {
      method: 'POST',
      body: { name: 'huge.png', dataUrl: `data:image/png;base64,${'A'.repeat(13 * 1024 * 1024)}` }
    });
    assert.strictEqual(res.status, 413);
    assert.strictEqual((await server.call('/')).status, 200, 'the server keeps serving afterwards');
  });
});

test('the serverless backend serves the whole site from Redis', async () => {
  const redis = await startFakeRedis();
  try {
    await withServer(
      { VERCEL: '1', KV_REST_API_URL: redis.url, KV_REST_API_TOKEN: redis.token },
      async (server) => {
        const health = await server.call('/healthz');
        assert.strictEqual(health.json.ok, true);
        assert.match(health.json.storage, /Redis/);

        assert.strictEqual((await server.call('/')).status, 200);

        await server.login();
        await server.call('/api/admin/site', { method: 'PUT', body: { site: { home: { subhead: 'Stored in Redis.' } } } });
        assert.match((await server.call('/')).text, /Stored in Redis\./);

        const upload = await server.call('/api/admin/uploads', {
          method: 'POST',
          body: { name: 'photo.png', dataUrl: `data:image/png;base64,${PNG.toString('base64')}` }
        });
        assert.strictEqual(upload.status, 201, 'images work without Blob configured');

        const served = await server.call(upload.json.file.url);
        assert.strictEqual(served.status, 200);
        assert.strictEqual(served.headers.get('content-type'), 'image/png');
        assert.match(served.headers.get('cache-control'), /immutable/);
        assert.ok(served.headers.get('etag'), 'an ETag lets browsers skip the Redis read');
      }
    );
  } finally {
    await redis.close();
  }
});

test('the whole site runs out of a GitHub repository', async () => {
  const gh = await startFakeGithub();
  const env = {
    VERCEL: '1',
    GITHUB_TOKEN: gh.token,
    GITHUB_REPO: `${gh.owner}/${gh.repo}`,
    GITHUB_BRANCH: 'main',
    GITHUB_API_URL: gh.api
  };

  try {
    await withServer(env, async (server) => {
      const health = await server.call('/healthz');
      assert.strictEqual(health.json.ok, true);
      assert.match(health.json.storage, /GitHub repository/);

      assert.strictEqual((await server.call('/')).status, 200);

      // Sessions here are signed rather than stored.
      assert.strictEqual((await server.login('nope')).status, 401);
      assert.strictEqual((await server.login('weed')).status, 200);
      assert.strictEqual((await server.call('/api/session')).json.signedIn, true);

      await server.call('/api/admin/site', { method: 'PUT', body: { site: { home: { subhead: 'Straight from git.' } } } });
      assert.match((await server.call('/')).text, /Straight from git\./);
      assert.match(
        gh.files.get('data/site.json').buffer.toString('utf8'),
        /Straight from git\./,
        'the change is a real file in the repo'
      );

      const upload = await server.call('/api/admin/uploads', {
        method: 'POST',
        body: { name: 'photo.png', dataUrl: `data:image/png;base64,${PNG.toString('base64')}` }
      });
      assert.strictEqual(upload.status, 201);
      assert.ok(gh.files.has('data/uploads/' + upload.json.file.name), 'the image is committed too');

      const served = await server.call(upload.json.file.url);
      assert.strictEqual(served.status, 200);
      assert.strictEqual(served.headers.get('content-type'), 'image/png');

      const backups = (await server.call('/api/admin/backups')).json.backups;
      assert.ok(backups.length >= 1, 'commit history shows up as snapshots');
    });
  } finally {
    await gh.close();
  }
});

test('signed sessions survive a restart, and reject tampering', async () => {
  const gh = await startFakeGithub();
  const env = {
    VERCEL: '1',
    GITHUB_TOKEN: gh.token,
    GITHUB_REPO: `${gh.owner}/${gh.repo}`,
    GITHUB_API_URL: gh.api
  };

  try {
    let cookie = null;
    await withServer(env, async (server) => {
      const res = await server.login('weed');
      assert.strictEqual(res.status, 200);
      cookie = res.headers.get('set-cookie').split(';')[0];
    });

    // A brand new process — nothing was stored anywhere, but the cookie holds.
    await withServer(env, async (server) => {
      const still = await fetch(`${server.base}/api/session`, { headers: { cookie } });
      assert.strictEqual((await still.json()).signedIn, true, 'no session store, yet still signed in');

      const tampered = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
      const forged = await fetch(`${server.base}/api/session`, { headers: { cookie: tampered } });
      assert.strictEqual((await forged.json()).signedIn, false, 'an edited cookie is rejected');
    });
  } finally {
    await gh.close();
  }
});

test('signing out everywhere invalidates an existing signed cookie', async () => {
  const gh = await startFakeGithub();
  const env = {
    VERCEL: '1',
    GITHUB_TOKEN: gh.token,
    GITHUB_REPO: `${gh.owner}/${gh.repo}`,
    GITHUB_API_URL: gh.api
  };

  try {
    await withServer(env, async (server) => {
      const res = await server.login('weed');
      const cookie = res.headers.get('set-cookie').split(';')[0];

      assert.strictEqual((await server.call('/api/admin/sessions', { method: 'DELETE' })).status, 200);

      const after = await fetch(`${server.base}/api/session`, { headers: { cookie } });
      assert.strictEqual((await after.json()).signedIn, false, 'the old generation is dead');

      assert.strictEqual((await server.login('weed')).status, 200, 'and you can sign back in');
    });
  } finally {
    await gh.close();
  }
});

test('changing the password invalidates signed cookies too', async () => {
  const gh = await startFakeGithub();
  const env = {
    VERCEL: '1',
    GITHUB_TOKEN: gh.token,
    GITHUB_REPO: `${gh.owner}/${gh.repo}`,
    GITHUB_API_URL: gh.api
  };

  try {
    await withServer(env, async (server) => {
      const res = await server.login('weed');
      const cookie = res.headers.get('set-cookie').split(';')[0];

      await server.call('/api/admin/password', { method: 'POST', body: { current: 'weed', next: 'a-new-one' } });

      const after = await fetch(`${server.base}/api/session`, { headers: { cookie } });
      assert.strictEqual((await after.json()).signedIn, false, 'the signing key moved with the password');
    });
  } finally {
    await gh.close();
  }
});

test('on Vercel without a store, the site explains itself instead of crashing', async () => {
  await withServer({ VERCEL: '1', GITHUB_TOKEN: null, GH_TOKEN: null }, async (server) => {
    const page = await server.call('/');
    assert.strictEqual(page.status, 503);
    assert.match(page.text, /Setup needed/);
    assert.match(page.text, /GITHUB_TOKEN/, 'the no-extra-service option is offered');
    assert.match(page.text, /Redis/, 'and the database option too');

    const health = await server.call('/healthz');
    assert.strictEqual(health.status, 503);
    assert.strictEqual(health.json.ok, false);

    assert.strictEqual((await server.call('/assets/css/site.css')).status, 200, 'static assets still serve');
  });
});
