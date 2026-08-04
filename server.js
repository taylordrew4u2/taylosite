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
  '.txt': 'text/plain; charset=utf-8'
};

const IMAGE_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/svg+xml': '.svg'
};

store.ensureDirs();
auth.ensurePassword();

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
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch (_) {
    throw Object.assign(new Error('Invalid JSON body'), { status: 400 });
  }
}

function serveFile(req, res, filePath, { cache = 'public, max-age=300' } = {}) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return notFound(req, res);
    const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      return res.end();
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      ETag: etag
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/** Resolve a request path inside a root directory, refusing traversal. */
function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath).replace(/\0/g, '');
  const target = path.normalize(path.join(root, decoded));
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

function notFound(req, res) {
  if ((req.headers.accept || '').includes('application/json') || req.url.startsWith('/api/')) {
    return sendJson(res, 404, { error: 'Not found' });
  }
  sendHtml(res, 404, render.renderNotFound(store.readSite()));
}

// ------------------------------------------------------------------- auth

function requireSession(req, res) {
  const cookies = auth.parseCookies(req.headers.cookie);
  const token = cookies[auth.COOKIE_NAME];
  const session = auth.getSession(token);
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
    return sendJson(res, 200, publicSite(store.readSite()));
  }

  if (route === '/session' && req.method === 'GET') {
    const cookies = auth.parseCookies(req.headers.cookie);
    const session = auth.getSession(cookies[auth.COOKIE_NAME]);
    return sendJson(res, 200, {
      signedIn: Boolean(session),
      csrf: session ? session.csrf : null,
      usingDefaultPassword: auth.usingDefaultPassword()
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
    if (!auth.checkPassword(body.password || '')) {
      auth.recordFailure(ip);
      return sendJson(res, 401, { error: 'Wrong password' });
    }
    auth.clearFailures(ip);
    const session = auth.createSession({ ip, agent: req.headers['user-agent'] });
    return sendJson(
      res,
      200,
      { ok: true, csrf: session.csrf, usingDefaultPassword: auth.usingDefaultPassword() },
      { 'Set-Cookie': auth.sessionCookie(session.token, { secure: isSecure(req) }) }
    );
  }

  if (route === '/logout' && req.method === 'POST') {
    const cookies = auth.parseCookies(req.headers.cookie);
    auth.revokeSession(cookies[auth.COOKIE_NAME]);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie({ secure: isSecure(req) }) });
  }

  // --- authenticated ------------------------------------------------------
  if (!route.startsWith('/admin')) return notFound(req, res);

  const ctx = requireSession(req, res);
  if (!ctx) return undefined;
  const adminRoute = route.replace(/^\/admin/, '');

  if (adminRoute === '/site' && req.method === 'GET') {
    const site = store.readSite();
    return sendJson(res, 200, {
      site: publicSite(site),
      stats: buildStats(site),
      sessions: auth.listSessions(ctx.token),
      usingDefaultPassword: auth.usingDefaultPassword()
    });
  }

  if (adminRoute === '/site' && req.method === 'PUT') {
    const body = await readJson(req);
    const current = store.readSite();
    if (body.expectedUpdatedAt && current.meta && current.meta.updatedAt && body.expectedUpdatedAt !== current.meta.updatedAt) {
      return sendJson(res, 409, {
        error: 'This site was changed in another tab or window. Reload before saving.',
        updatedAt: current.meta.updatedAt
      });
    }
    const next = normalizeSite(body.site, current);
    store.writeSite(next);
    return sendJson(res, 200, { ok: true, site: publicSite(next), stats: buildStats(next) });
  }

  if (adminRoute === '/site/reset' && req.method === 'POST') {
    const current = store.readSite();
    const fresh = defaultSite();
    fresh.auth = current.auth;
    fresh.meta = { updatedAt: new Date().toISOString() };
    store.writeSite(fresh);
    return sendJson(res, 200, { ok: true, site: publicSite(fresh), stats: buildStats(fresh) });
  }

  if (adminRoute === '/password' && req.method === 'POST') {
    const body = await readJson(req);
    if (!auth.checkPassword(body.current || '')) {
      return sendJson(res, 401, { error: 'Current password is wrong' });
    }
    const next = String(body.next || '');
    if (next.length < 4) return sendJson(res, 400, { error: 'New password must be at least 4 characters' });
    auth.setPassword(next);
    return sendJson(res, 200, { ok: true, signedOut: true }, { 'Set-Cookie': auth.clearCookie({ secure: isSecure(req) }) });
  }

  if (adminRoute === '/sessions' && req.method === 'DELETE') {
    auth.revokeAllSessions();
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie({ secure: isSecure(req) }) });
  }

  if (adminRoute === '/uploads' && req.method === 'GET') {
    return sendJson(res, 200, { files: store.listUploads() });
  }

  if (adminRoute === '/uploads' && req.method === 'POST') {
    const body = await readJson(req);
    const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(body.dataUrl || ''));
    if (!match) return sendJson(res, 400, { error: 'Expected a base64 data URL' });
    const ext = IMAGE_TYPES[match[1].toLowerCase()];
    if (!ext) return sendJson(res, 415, { error: `Unsupported image type: ${match[1]}` });
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 8 * 1024 * 1024) return sendJson(res, 413, { error: 'Image is larger than 8 MB' });
    const base = String(body.name || 'image')
      .toLowerCase()
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'image';
    const name = `${base}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(store.UPLOAD_DIR, name), buffer);
    return sendJson(res, 201, { ok: true, file: { name, url: `/uploads/${name}`, size: buffer.length } });
  }

  if (adminRoute.startsWith('/uploads/') && req.method === 'DELETE') {
    try {
      store.deleteUpload(decodeURIComponent(adminRoute.slice('/uploads/'.length)));
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (adminRoute === '/backups' && req.method === 'GET') {
    return sendJson(res, 200, { backups: store.listBackups() });
  }

  if (adminRoute === '/backups/restore' && req.method === 'POST') {
    const body = await readJson(req);
    try {
      const snapshot = store.readBackup(String(body.name || ''));
      const current = store.readSite();
      const restored = normalizeSite(snapshot, current);
      // Restoring content must never roll the password back.
      restored.auth = current.auth;
      store.writeSite(restored);
      return sendJson(res, 200, { ok: true, site: publicSite(restored), stats: buildStats(restored) });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (adminRoute === '/export' && req.method === 'GET') {
    const site = publicSite(store.readSite());
    return send(res, 200, JSON.stringify(site, null, 2), {
      'Content-Type': MIME['.json'],
      'Content-Disposition': `attachment; filename="taylosite-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store'
    });
  }

  if (adminRoute === '/import' && req.method === 'POST') {
    const body = await readJson(req);
    const current = store.readSite();
    const imported = normalizeSite(body.site, current);
    imported.auth = current.auth;
    store.writeSite(imported);
    return sendJson(res, 200, { ok: true, site: publicSite(imported), stats: buildStats(imported) });
  }

  if (adminRoute === '/analytics/reset' && req.method === 'POST') {
    const next = store.update((site) => {
      site.links.items = (site.links.items || []).map((item) => ({ ...item, clicks: 0 }));
      return site;
    });
    return sendJson(res, 200, { ok: true, site: publicSite(next), stats: buildStats(next) });
  }

  return notFound(req, res);
}

function buildStats(site) {
  const items = site.links.items || [];
  const today = new Date().toISOString().slice(0, 10);
  const shows = site.shows || [];
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
    uploads: store.listUploads().length,
    updatedAt: site.meta && site.meta.updatedAt
  };
}

function handleClickThrough(req, res, url) {
  const id = decodeURIComponent(url.pathname.slice('/go/'.length));
  const site = store.readSite();
  const link = (site.links.items || []).find((l) => l.id === id);
  if (!link || !link.url) return notFound(req, res);
  // A click is not a content edit — do not spend a backup slot on it.
  store.update((s) => {
    const target = (s.links.items || []).find((l) => l.id === id);
    if (target) target.clicks = (Number(target.clicks) || 0) + 1;
    return s;
  }, { backup: false });
  res.writeHead(302, { Location: link.url, 'Cache-Control': 'no-store' });
  res.end();
}

const PAGES = {
  '/': render.renderHome,
  '/about': render.renderAbout,
  '/links': render.renderLinks
};

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (pathname.startsWith('/go/')) return handleClickThrough(req, res, url);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  if (pathname === '/admin') {
    return serveFile(req, res, path.join(PUBLIC_DIR, 'admin.html'), { cache: 'no-cache' });
  }

  if (pathname.startsWith('/assets/')) {
    const file = safeJoin(PUBLIC_DIR, pathname);
    if (!file) return notFound(req, res);
    return serveFile(req, res, file, { cache: 'public, max-age=600' });
  }

  if (pathname.startsWith('/uploads/')) {
    const file = safeJoin(store.UPLOAD_DIR, pathname.slice('/uploads'.length));
    if (!file) return notFound(req, res);
    return serveFile(req, res, file, { cache: 'public, max-age=86400' });
  }

  const origin = `${isSecure(req) ? 'https' : 'http'}://${req.headers.host || 'localhost'}`;

  if (pathname === '/robots.txt') {
    return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /go/\nSitemap: ${origin}/sitemap.xml\n`, {
      'Content-Type': MIME['.txt']
    });
  }

  if (pathname === '/sitemap.xml') {
    const updated = (store.readSite().meta || {}).updatedAt || new Date().toISOString();
    const urls = Object.keys(PAGES)
      .map(
        (page) =>
          `  <url><loc>${origin}${page}</loc><lastmod>${updated.slice(0, 10)}</lastmod></url>`
      )
      .join('\n');
    return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
      'Content-Type': 'application/xml; charset=utf-8'
    });
  }

  if (pathname === '/healthz') return sendJson(res, 200, { ok: true });

  const page = PAGES[pathname];
  if (page) return sendHtml(res, 200, page(store.readSite(), { origin }));

  return notFound(req, res);
}

const server = http.createServer((req, res) => {
  Promise.resolve(handle(req, res)).catch((err) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[server]', err);
    if (!res.headersSent) sendJson(res, status, { error: err.message || 'Server error' });
    else res.end();
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`\n  Taylor Drew site running at http://localhost:${PORT}`);
    console.log(`  Admin panel:                http://localhost:${PORT}/admin`);
    if (auth.usingDefaultPassword()) {
      console.log(`  Admin password:             "${auth.DEFAULT_PASSWORD}" (change it in Admin → Security)\n`);
    } else {
      console.log('');
    }
  });
}

module.exports = server;
