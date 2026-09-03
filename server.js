'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./lib/store');
const auth = require('./lib/auth');
const { normalizeSite, publicSite } = require('./lib/schema');
const { defaultSite } = require('./lib/defaults');
const render = require('./lib/render');
const instagram = require('./lib/instagram');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 12 * 1024 * 1024; // generous enough for a base64 photo

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

// Uploads. Video is here so a reel can be hosted on the site itself — whether
// it fits is the storage backend's call (Redis caps uploads far below a video;
// Vercel Blob does not), and the size error says so in plain words.
const IMAGE_TYPES = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/svg+xml': '.svg'
};

// ------------------------------------------------------------------ helpers

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

function isSecure(req) {
  return req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted);
}

function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    'Content-Length': payload.length,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...headers
  });
  res.end(payload);
}

function sendHtml(res, status, html, headers = {}) {
  send(res, status, html, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache', ...headers });
}

function sendJson(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), {
    'Content-Type': MIME['.json'],
    'Cache-Control': 'no-store',
    ...headers
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        aborted = true;
        chunks.length = 0;
        // Drain rather than destroy, so there is still a socket to answer on
        // and the client gets a 413 instead of a dropped connection.
        req.resume();
        reject(Object.assign(new Error(`Upload is larger than ${Math.round(MAX_BODY / 1024 / 1024)} MB`), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  // Serverless platforms may hand the body over already parsed.
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = Buffer.isBuffer(req.body) ? req.body : await readBody(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch (_) {
    throw Object.assign(new Error('Invalid JSON body'), { status: 400 });
  }
}

function serveFile(req, res, filePath, { cache = 'public, max-age=300' } = {}) {
  return new Promise((resolve) => {
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) return resolve(notFound(req, res));
      const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag });
        res.end();
        return resolve();
      }
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': stat.size,
        'Cache-Control': cache,
        'X-Content-Type-Options': 'nosniff',
        ETag: etag
      });
      fs.createReadStream(filePath).pipe(res).on('finish', resolve);
    });
  });
}

/** Resolve a request path inside a root directory, refusing traversal. */
function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath).replace(/\0/g, '');
  const target = path.normalize(path.join(root, decoded));
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

async function notFound(req, res) {
  if ((req.headers.accept || '').includes('application/json') || req.url.startsWith('/api/')) {
    return sendJson(res, 404, { error: 'Not found' });
  }
  sendHtml(res, 404, render.renderNotFound(await store.readSite()));
}

// ------------------------------------------------------------------- boot

let readyPromise = null;
function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      store.ensureDirs();
      await auth.ensurePassword();
    })().catch((err) => {
      readyPromise = null; // let a later request retry once the config is fixed
      throw err;
    });
  }
  return readyPromise;
}

// ------------------------------------------------------------------- auth

async function requireSession(req, res) {
  const cookies = auth.parseCookies(req.headers.cookie);
  const token = cookies[auth.COOKIE_NAME];
  const session = await auth.getSession(token);
  if (!session) {
    sendJson(res, 401, { error: 'Not signed in' });
    return null;
  }
  // Cookies are SameSite=Lax, and every mutation additionally carries the
  // per-session CSRF token issued at login.
  if (req.method !== 'GET' && req.headers['x-csrf-token'] !== session.csrf) {
    sendJson(res, 403, { error: 'Invalid CSRF token' });
    return null;
  }
  return { token, session };
}

// ------------------------------------------------------------------ routes

async function handleApi(req, res, url) {
  const route = url.pathname.replace(/^\/api/, '');

  // --- public -------------------------------------------------------------
  if (route === '/content' && req.method === 'GET') {
    return sendJson(res, 200, publicSite(await store.readSite()));
  }

  if (route === '/session' && req.method === 'GET') {
    const cookies = auth.parseCookies(req.headers.cookie);
    const session = await auth.getSession(cookies[auth.COOKIE_NAME]);
    return sendJson(res, 200, {
      signedIn: Boolean(session),
      csrf: session ? session.csrf : null,
      usingDefaultPassword: await auth.usingDefaultPassword()
    });
  }

  if (route === '/login' && req.method === 'POST') {
    const ip = clientIp(req);
    const wait = auth.loginBlocked(ip);
    if (wait) {
      return sendJson(res, 429, {
        error: `Too many attempts. Try again in ${Math.ceil(wait / 60000)} minute(s).`
      });
    }
    const body = await readJson(req);
    if (!(await auth.checkPassword(body.password || ''))) {
      auth.recordFailure(ip);
      return sendJson(res, 401, { error: 'Wrong password' });
    }
    auth.clearFailures(ip);
    const session = await auth.createSession({ ip, agent: req.headers['user-agent'] });
    return sendJson(
      res,
      200,
      { ok: true, csrf: session.csrf, usingDefaultPassword: await auth.usingDefaultPassword() },
      { 'Set-Cookie': auth.sessionCookie(session.token, { secure: isSecure(req) }) }
    );
  }

  if (route === '/logout' && req.method === 'POST') {
    const cookies = auth.parseCookies(req.headers.cookie);
    await auth.revokeSession(cookies[auth.COOKIE_NAME]);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie({ secure: isSecure(req) }) });
  }

  // --- authenticated ------------------------------------------------------
  if (!route.startsWith('/admin')) return notFound(req, res);

  const ctx = await requireSession(req, res);
  if (!ctx) return undefined;
  const adminRoute = route.replace(/^\/admin/, '');

  if (adminRoute === '/site' && req.method === 'GET') {
    const site = await store.readSite();
    return sendJson(res, 200, {
      site: publicSite(site),
      stats: await buildStats(site),
      sessions: await auth.listSessions(ctx.token),
      usingDefaultPassword: await auth.usingDefaultPassword(),
      storage: store.describe()
    });
  }

  if (adminRoute === '/site' && req.method === 'PUT') {
    const body = await readJson(req);
    const current = await store.readSite();
    // If the client names the version it edited, it has to be the version we
    // hold — including when we hold none, which means it is editing something
    // that no longer exists.
    const currentUpdatedAt = (current.meta && current.meta.updatedAt) || null;
    if (body.expectedUpdatedAt && body.expectedUpdatedAt !== currentUpdatedAt) {
      return sendJson(res, 409, {
        error: 'This site was changed in another tab or window. Reload before saving.',
        updatedAt: currentUpdatedAt
      });
    }
    const next = normalizeSite(body.site, current);
    await store.writeSite(next);
    return sendJson(res, 200, { ok: true, site: publicSite(next), stats: await buildStats(next) });
  }

  if (adminRoute === '/site/reset' && req.method === 'POST') {
    const current = await store.readSite();
    const fresh = defaultSite();
    fresh.auth = current.auth;
    fresh.meta = { updatedAt: new Date().toISOString() };
    await store.writeSite(fresh);
    return sendJson(res, 200, { ok: true, site: publicSite(fresh), stats: await buildStats(fresh) });
  }

  if (adminRoute === '/password' && req.method === 'POST') {
    const body = await readJson(req);
    if (!(await auth.checkPassword(body.current || ''))) {
      return sendJson(res, 401, { error: 'Current password is wrong' });
    }
    const next = String(body.next || '');
    if (next.length < 4) return sendJson(res, 400, { error: 'New password must be at least 4 characters' });
    await auth.setPassword(next);
    return sendJson(res, 200, { ok: true, signedOut: true }, { 'Set-Cookie': auth.clearCookie({ secure: isSecure(req) }) });
  }

  if (adminRoute === '/sessions' && req.method === 'DELETE') {
    await auth.revokeAllSessions();
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie({ secure: isSecure(req) }) });
  }

  if (adminRoute === '/uploads' && req.method === 'GET') {
    return sendJson(res, 200, { files: await store.listUploads() });
  }

  if (adminRoute === '/uploads' && req.method === 'POST') {
    const body = await readJson(req);
    const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(body.dataUrl || ''));
    if (!match) return sendJson(res, 400, { error: 'Expected a base64 data URL' });
    const contentType = match[1].toLowerCase();
    const ext = IMAGE_TYPES[contentType];
    if (!ext) return sendJson(res, 415, { error: `Unsupported file type: ${match[1]}` });
    const buffer = Buffer.from(match[2], 'base64');
    const limit = store.maxImageBytes();
    if (buffer.length > limit) {
      return sendJson(res, 413, {
        error: `File is ${Math.round(buffer.length / 1024)} KB — the limit here is ${Math.round(
          limit / 1024
        )} KB. Images fit; a video usually needs Vercel Blob storage, or host it elsewhere and paste the URL.`
      });
    }
    const base = String(body.name || 'image')
      .toLowerCase()
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'image';
    const name = `${base}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    const file = await store.putUpload(name, buffer, contentType);
    return sendJson(res, 201, { ok: true, file });
  }

  if (adminRoute.startsWith('/uploads/') && req.method === 'DELETE') {
    try {
      await store.deleteUpload(decodeURIComponent(adminRoute.slice('/uploads/'.length)));
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (adminRoute === '/backups' && req.method === 'GET') {
    return sendJson(res, 200, { backups: await store.listBackups() });
  }

  if (adminRoute === '/backups/restore' && req.method === 'POST') {
    const body = await readJson(req);
    try {
      const snapshot = await store.readBackup(String(body.name || ''));
      const current = await store.readSite();
      const restored = normalizeSite(snapshot, current);
      // Restoring content must never roll the password back.
      restored.auth = current.auth;
      await store.writeSite(restored);
      return sendJson(res, 200, { ok: true, site: publicSite(restored), stats: await buildStats(restored) });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (adminRoute === '/export' && req.method === 'GET') {
    const site = publicSite(await store.readSite());
    return send(res, 200, JSON.stringify(site, null, 2), {
      'Content-Type': MIME['.json'],
      'Content-Disposition': `attachment; filename="taylosite-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store'
    });
  }

  if (adminRoute === '/import' && req.method === 'POST') {
    const body = await readJson(req);
    const current = await store.readSite();
    const imported = normalizeSite(body.site, current);
    imported.auth = current.auth;
    await store.writeSite(imported);
    return sendJson(res, 200, { ok: true, site: publicSite(imported), stats: await buildStats(imported) });
  }

  if (adminRoute === '/analytics/reset' && req.method === 'POST') {
    const next = await store.resetClicks();
    return sendJson(res, 200, { ok: true, site: publicSite(next), stats: await buildStats(next) });
  }

  return notFound(req, res);
}

async function buildStats(site) {
  const items = site.links.items || [];
  const today = new Date().toISOString().slice(0, 10);
  const shows = site.shows || [];
  let uploads = 0;
  try {
    uploads = (await store.listUploads()).length;
  } catch (_) {
    // Image storage may not be configured yet; the rest of the panel still works.
  }
  return {
    links: items.length,
    linksVisible: items.filter((l) => l.visible !== false).length,
    clicks: items.reduce((sum, l) => sum + (Number(l.clicks) || 0), 0),
    topLinks: [...items]
      .sort((a, b) => (Number(b.clicks) || 0) - (Number(a.clicks) || 0))
      .slice(0, 5)
      .map((l) => ({ id: l.id, label: l.label, clicks: Number(l.clicks) || 0 })),
    shows: shows.length,
    upcomingShows: shows.filter((s) => s.visible !== false && (!s.date || s.date >= today)).length,
    uploads,
    updatedAt: site.meta && site.meta.updatedAt
  };
}

async function handleClickThrough(req, res, url) {
  const id = decodeURIComponent(url.pathname.slice('/go/'.length));
  const site = await store.readSite();
  const link = (site.links.items || []).find((l) => l.id === id);
  if (!link || !link.url) return notFound(req, res);
  try {
    await store.bumpClick(id);
  } catch (err) {
    // A counter failure must never stop the visitor reaching the link.
    console.error(`[server] click count failed: ${err.message}`);
  }
  res.writeHead(302, { Location: link.url, 'Cache-Control': 'no-store' });
  res.end();
}

const PAGES = {
  '/': render.renderHome,
  '/about': render.renderAbout,
  '/links': render.renderLinks,
  '/reels': render.renderReels
};

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
function escapeXml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

/**
 * Crawlers that answer questions rather than return links — they read the site
 * and cite it, so they are named here instead of being left to the wildcard.
 * The distinction is worth keeping: the first group sends people back, the
 * second only reads for training. To stay out of training corpora while
 * remaining answerable, change Allow to Disallow in the second group.
 */
const ANSWER_CRAWLERS = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User', 'ClaudeBot', 'Claude-User', 'Applebot', 'Bingbot'];
// Applebot-Extended and Google-Extended are training controls, not crawlers of
// their own: they govern what Apple and Google may train on, nothing else.
const TRAINING_CRAWLERS = ['GPTBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'anthropic-ai', 'Meta-ExternalAgent', 'Amazonbot', 'Bytespider'];

// Nothing here is content: /admin is the panel, /api answers JSON to it, and
// /go/ is a redirector whose destinations are already published as real URLs in
// the links page's structured data. Crawled, they would only dilute the site.
const OFF_LIMITS = ['Disallow: /admin', 'Disallow: /api/', 'Disallow: /go/'];

function robotsTxt(origin) {
  const block = (agents, note) =>
    [`# ${note}`, ...agents.map((a) => `User-agent: ${a}`), 'Allow: /', ...OFF_LIMITS, ''].join('\n');
  return [
    'User-agent: *',
    'Allow: /',
    ...OFF_LIMITS,
    '',
    block(ANSWER_CRAWLERS, 'Answer engines — these cite the site and send people to it.'),
    block(TRAINING_CRAWLERS, 'Training crawlers — change Allow to Disallow to opt out.'),
    `Sitemap: ${origin}/sitemap.xml`,
    // Not a standard directive, but it is where the crawlers that look for a
    // plain-text summary look first, and robots.txt is the file they all fetch.
    `# llms.txt: ${origin}/llms.txt`,
    ''
  ].join('\n');
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  // /about/ and /about must not both answer 200, or they compete as duplicates
  // in search results. One canonical spelling, everything else redirected.
  if (url.pathname !== pathname && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(301, { Location: pathname + url.search, 'Cache-Control': 'public, max-age=3600' });
    return res.end();
  }

  // Static assets never need storage, so serve them before the boot check.
  if (pathname.startsWith('/assets/')) {
    const file = safeJoin(PUBLIC_DIR, pathname);
    if (!file) return sendJson(res, 404, { error: 'Not found' });
    return serveFile(req, res, file, { cache: 'public, max-age=600' });
  }

  if (pathname === '/admin') {
    return serveFile(req, res, path.join(PUBLIC_DIR, 'admin.html'), { cache: 'no-cache' });
  }

  if (pathname === '/healthz') {
    // Deployment identity and which credentials this build can see — the two
    // things you cannot otherwise tell from outside, and the ones that explain
    // almost every "I added it but nothing changed".
    const build = {
      env: process.env.VERCEL_ENV || (process.env.VERCEL ? 'vercel' : 'local'),
      deployment: process.env.VERCEL_URL || null,
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null
    };
    try {
      await ensureReady();
      return sendJson(res, 200, {
        ok: true,
        storage: store.describe(),
        credentials: { ...store.credentials(), instagram: instagram.isConfigured() },
        build
      });
    } catch (err) {
      return sendJson(res, 503, { ok: false, error: err.message, credentials: store.credentials(), build });
    }
  }

  try {
    await ensureReady();
  } catch (err) {
    // Storage is not configured — say so in plain words rather than 500ing.
    if (pathname.startsWith('/api/')) return sendJson(res, 503, { error: err.message });
    return sendSetupError(res, err);
  }

  if (pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (pathname.startsWith('/go/')) return handleClickThrough(req, res, url);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  if (pathname.startsWith('/uploads/')) {
    const name = decodeURIComponent(pathname.slice('/uploads/'.length));
    const image = await store.readUpload(name);
    if (!image) return notFound(req, res);
    if (image.redirect) {
      res.writeHead(302, { Location: image.redirect, 'Cache-Control': 'public, max-age=3600' });
      return res.end();
    }
    if (image.buffer) {
      // Names carry a random suffix, so the bytes behind one never change and
      // browsers can hold onto them — which keeps Redis reads off the hot path.
      const etag = `"${crypto.createHash('sha1').update(image.buffer).digest('hex').slice(0, 16)}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag });
        return res.end();
      }
      return send(res, 200, image.buffer, {
        'Content-Type': image.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: etag
      });
    }
    return serveFile(req, res, image.file, { cache: 'public, max-age=86400' });
  }

  const origin = `${isSecure(req) ? 'https' : 'http'}://${req.headers.host || 'localhost'}`;

  if (pathname === '/robots.txt') {
    return send(res, 200, robotsTxt(origin), { 'Content-Type': MIME['.txt'] });
  }

  // Drawn from the brand rather than uploaded — see faviconSvg for why a tab
  // cannot use a wordmark. .ico is answered too because bookmark managers and
  // link previewers still ask for it by name whatever the page declares.
  if (pathname === '/favicon.svg' || pathname === '/favicon-dark.svg' || pathname === '/favicon.ico') {
    return send(res, 200, render.faviconSvg(await store.readSite(), { dark: pathname === '/favicon-dark.svg' }), {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    });
  }

  if (pathname === '/site.webmanifest') {
    return send(res, 200, render.webManifest(await store.readSite()), {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    });
  }

  // Answer engines look for this before crawling the pages themselves.
  if (pathname === '/llms.txt') {
    return send(res, 200, render.llmsTxt(await store.readSite(), origin), {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300'
    });
  }

  if (pathname === '/sitemap.xml') {
    const site = await store.readSite();
    const updated = (site.meta || {}).updatedAt || new Date().toISOString();
    // Naming the photo on the page it belongs to is what gets it into image
    // search; a crawler will not pair them up on its own.
    const photos = {
      '/': [{ url: site.home.photo, caption: site.home.photoAlt }],
      '/about': [{ url: site.about.photo, caption: site.about.photoAlt }]
    };
    const urls = Object.keys(PAGES)
      .map((page) => {
        const images = (photos[page] || [])
          .filter((p) => p.url)
          .map(
            (p) =>
              `<image:image><image:loc>${escapeXml(origin + p.url)}</image:loc>` +
              `<image:title>${escapeXml(site.brand.name)}</image:title>` +
              // The caption is the alt text — the one sentence that says what is
              // in the picture, which is all image search has to go on.
              `<image:caption>${escapeXml(p.caption || site.brand.name)}</image:caption></image:image>`
          )
          .join('');
        return `  <url><loc>${origin}${page}</loc><lastmod>${updated.slice(0, 10)}</lastmod>${images}</url>`;
      })
      .join('\n');
    return send(
      res,
      200,
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls}\n</urlset>\n`,
      { 'Content-Type': 'application/xml; charset=utf-8' }
    );
  }

  if (pathname === '/reels') {
    const feed = await instagram.fetchReels();
    return sendHtml(res, 200, render.renderReels(await store.readSite(), { origin, remote: feed.reels, error: feed.error }));
  }

  const page = PAGES[pathname];
  if (page) return sendHtml(res, 200, page(await store.readSite(), { origin }));

  return notFound(req, res);
}

/** A misconfigured deployment should say so in plain words, not throw a stack. */
function sendSetupError(res, err) {
  // Which deployment this is matters: a preview build does not automatically
  // get variables scoped to Production, and that looks identical from outside.
  const where = [
    process.env.VERCEL_ENV ? `environment: ${process.env.VERCEL_ENV}` : '',
    process.env.VERCEL_URL ? `deployment: ${process.env.VERCEL_URL}` : ''
  ]
    .filter(Boolean)
    .join(' · ');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Setup needed</title><style>
body{background:#0b0b0b;color:#fff;font:16px/1.6 Helvetica,Arial,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;padding:24px}
main{max-width:44rem;border:2px solid #2b2b2b;padding:32px}
h1{font-size:2rem;font-weight:900;letter-spacing:-.02em;text-transform:uppercase;margin:0 0 8px}
.rule{height:3px;background:#ef4123;margin:18px 0 22px}
code{background:#1a1a1a;padding:2px 6px}
</style></head><body><main>
<p style="letter-spacing:.2em;text-transform:uppercase;font-size:.7rem;color:#8d8d8d;margin:0">Taylor Drew</p>
<h1>Setup needed</h1><div class="rule"></div>
<p>${render.esc(err.message)}</p>
${where ? `<p style="color:#8d8d8d;font-size:.85rem">This page is being served by — ${render.esc(where)}</p>` : ''}
<p style="color:#8d8d8d">Once the storage integration is connected and the project redeployed, this page becomes the site.</p>
</main></body></html>`;
  send(res, 503, html, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
}

const server = http.createServer((req, res) => {
  Promise.resolve(handle(req, res)).catch((err) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[server]', err);
    if (res.headersSent) return res.end();
    // The "setup needed" page is only for a backend that could not be created
    // at all — see the ensureReady() catch. A failure here is a real fault and
    // should read like one rather than blaming configuration.
    sendJson(res, status, { error: err.message || 'Server error' });
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`\n  Taylor Drew site running at http://localhost:${PORT}`);
    console.log(`  Admin panel:                http://localhost:${PORT}/admin`);
    console.log(`  Storage:                    ${store.describe()}`);
    auth
      .usingDefaultPassword()
      .then((isDefault) => {
        if (isDefault) console.log(`  Admin password:             "${auth.DEFAULT_PASSWORD}" (change it in Admin → Security)\n`);
        else console.log('');
      })
      .catch((err) => console.log(`\n  Storage is not ready: ${err.message}\n`));
  });
}

module.exports = server;
