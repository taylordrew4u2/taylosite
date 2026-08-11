'use strict';

/**
 * Where the site's data actually lives.
 *
 * Three backends, chosen automatically from the environment:
 *
 *   filesystem   the default — a `data/` directory. Used locally, on a VPS, or
 *                anywhere with a real disk.
 *   serverless   Redis for the site document, sessions and backups, plus Vercel
 *                Blob for images (or Redis again when Blob is not configured).
 *   github       the repository itself, through the Contents API. Needs no
 *                service beyond a GitHub token, so it is the option that costs
 *                nothing. Every save is a commit.
 *
 * Everything is async so the backends can share one interface:
 *
 *   readSiteDoc()             -> object | null
 *   writeSiteDoc(doc)
 *   bumpClick(id)             atomic, never clobbers a concurrent save
 *   listBackups()             -> [{ name, size, createdAt }]
 *   readBackup(name)          -> object
 *   saveBackup(name, doc)
 *   pruneBackups(keep)
 *   readSession(token)        -> object | null
 *   writeSession(token, s, ttlSeconds)
 *   deleteSession(token)
 *   listSessions()            -> [{ token, ...session }]
 *   clearSessions()
 *   putImage(name, buf, type) -> { name, url, size }
 *   listImages()              -> [{ name, url, size, createdAt }]
 *   deleteImage(name)
 *   readImage(name)           -> { buffer, type } | { redirect } | null
 */

const fs = require('fs');
const path = require('path');

const SITE_KEY = 'site.json';

// --------------------------------------------------------------- filesystem

function createFilesystemBackend() {
  const DATA_DIR = process.env.TAYLOSITE_DATA_DIR
    ? path.resolve(process.env.TAYLOSITE_DATA_DIR)
    : path.join(__dirname, '..', 'data');
  const SITE_FILE = path.join(DATA_DIR, SITE_KEY);
  const BACKUP_DIR = path.join(DATA_DIR, 'backups');
  const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
  const SESSION_FILE = path.join(DATA_DIR, 'sessions.json');

  function ensureDirs() {
    for (const dir of [DATA_DIR, BACKUP_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });
  }

  function readSessionFile() {
    try {
      return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    } catch (_) {
      return {};
    }
  }

  function writeSessionFile(all) {
    ensureDirs();
    const tmp = `${SESSION_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all));
    fs.renameSync(tmp, SESSION_FILE);
  }

  return {
    name: 'filesystem',
    description: `filesystem (${DATA_DIR})`,
    uploadDir: UPLOAD_DIR,
    maxImageBytes: 8 * 1024 * 1024,
    ensureDirs,

    async readSiteDoc() {
      ensureDirs();
      if (!fs.existsSync(SITE_FILE)) return null;
      try {
        return JSON.parse(fs.readFileSync(SITE_FILE, 'utf8'));
      } catch (err) {
        // Keep a corrupt file for forensics rather than losing it silently.
        const wrecked = path.join(BACKUP_DIR, `corrupt-${Date.now()}.json`);
        try {
          fs.copyFileSync(SITE_FILE, wrecked);
        } catch (_) {
          /* best effort */
        }
        console.error(`[storage] site.json was unreadable (${err.message}); copy at ${wrecked}`);
        return null;
      }
    },

    async writeSiteDoc(doc) {
      ensureDirs();
      const tmp = `${SITE_FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
      fs.renameSync(tmp, SITE_FILE);
    },

    async bumpClick(id) {
      // Single process, so read-modify-write is safe here.
      const doc = await this.readSiteDoc();
      if (!doc) return;
      const link = (doc.links.items || []).find((l) => l.id === id);
      if (!link) return;
      link.clicks = (Number(link.clicks) || 0) + 1;
      await this.writeSiteDoc(doc);
    },

    async applyClicks(doc) {
      return doc;
    },

    async listBackups() {
      ensureDirs();
      return fs
        .readdirSync(BACKUP_DIR)
        .filter((name) => name.startsWith('site-') && name.endsWith('.json'))
        .sort()
        .reverse()
        .map((name) => {
          const stat = fs.statSync(path.join(BACKUP_DIR, name));
          return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
        });
    },

    async readBackup(name) {
      const file = path.join(BACKUP_DIR, name);
      if (!fs.existsSync(file)) throw new Error('Backup not found');
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    },

    async saveBackup(name, doc) {
      ensureDirs();
      fs.writeFileSync(path.join(BACKUP_DIR, name), JSON.stringify(doc, null, 2));
    },

    async pruneBackups(keep) {
      const backups = await this.listBackups();
      for (const old of backups.slice(keep)) {
        try {
          fs.unlinkSync(path.join(BACKUP_DIR, old.name));
        } catch (_) {
          /* best effort */
        }
      }
    },

    async readSession(token) {
      const session = readSessionFile()[token];
      if (!session) return null;
      if (session.expiresAt < Date.now()) {
        await this.deleteSession(token);
        return null;
      }
      return session;
    },

    async writeSession(token, session) {
      const all = readSessionFile();
      all[token] = session;
      writeSessionFile(all);
    },

    async deleteSession(token) {
      const all = readSessionFile();
      if (token in all) {
        delete all[token];
        writeSessionFile(all);
      }
    },

    async listSessions() {
      const now = Date.now();
      return Object.entries(readSessionFile())
        .filter(([, s]) => s.expiresAt > now)
        .map(([token, s]) => ({ token, ...s }));
    },

    async clearSessions() {
      writeSessionFile({});
    },

    async putImage(name, buffer) {
      ensureDirs();
      fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
      return { name, url: `/uploads/${name}`, size: buffer.length };
    },

    async listImages() {
      ensureDirs();
      return fs
        .readdirSync(UPLOAD_DIR)
        .filter((name) => !name.startsWith('.'))
        .map((name) => {
          const stat = fs.statSync(path.join(UPLOAD_DIR, name));
          return { name, url: `/uploads/${name}`, size: stat.size, createdAt: stat.mtime.toISOString() };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async deleteImage(name) {
      const file = path.join(UPLOAD_DIR, name);
      if (!fs.existsSync(file)) throw new Error('File not found');
      fs.unlinkSync(file);
    },

    async readImage(name) {
      const file = path.join(UPLOAD_DIR, name);
      if (!fs.existsSync(file)) return null;
      return { file };
    }
  };
}

// --------------------------------------------------------------- serverless

/** Upstash's REST API speaks plain JSON command arrays — no client needed. */
function createRedisClient(url, token) {
  const base = url.replace(/\/+$/, '');
  return async function command(args) {
    const res = await fetch(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args.map(String))
    });
    const text = await res.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (_) {
      throw new Error(`Redis returned invalid JSON (HTTP ${res.status})`);
    }
    if (!res.ok || payload.error) {
      throw new Error(`Redis ${args[0]} failed: ${payload.error || res.statusText}`);
    }
    return payload.result;
  };
}

/**
 * Layer one image store over another: new uploads go to `primary`, while
 * anything still in `fallback` stays readable, listable and deletable. Used
 * when Vercel Blob is added to a site whose images were already in Redis.
 */
function composeImageStores(primary, fallback) {
  return {
    limit: primary.limit,

    put: (name, buffer, contentType) => primary.put(name, buffer, contentType),

    async list() {
      const [ahead, behind] = await Promise.all([
        primary.list().catch(() => []),
        fallback.list().catch(() => [])
      ]);
      const seen = new Set(ahead.map((image) => image.name));
      return ahead
        .concat(behind.filter((image) => !seen.has(image.name)))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    },

    async remove(name) {
      try {
        return await primary.remove(name);
      } catch (err) {
        // Not in the new store — it may be one of the older ones.
        return fallback.remove(name);
      }
    },

    async read(name) {
      const found = await primary.read(name).catch(() => null);
      return found || fallback.read(name);
    }
  };
}

/**
 * Upstash's free tier caps a single request at 1 MB, so an image kept in Redis
 * has to stay comfortably under that once base64 has added its third.
 */
const REDIS_IMAGE_LIMIT = 700 * 1024;

function createServerlessBackend(config) {
  const redis = createRedisClient(config.redisUrl, config.redisToken);
  const blobToken = config.blobToken;
  const CLICKS_KEY = 'taylosite:clicks';
  const SITE = 'taylosite:site';
  const BACKUP_INDEX = 'taylosite:backups';
  const IMAGE_INDEX = 'taylosite:images';
  const backupKey = (name) => `taylosite:backup:${name}`;
  const sessionKey = (token) => `taylosite:session:${token}`;
  const imageKey = (name) => `taylosite:image:${name}`;

  // The Blob SDK is only loaded when Blob is actually configured, so a
  // deployment without it never pays for the require.
  let blob = null;
  function blobApi() {
    if (!blob) blob = require('@vercel/blob');
    return blob;
  }

  // ---- images ------------------------------------------------------------
  // Vercel Blob when it is available, otherwise Redis. Keeping images in Redis
  // needs no second service, which is what the free path relies on.

  const blobImages = {
    limit: 8 * 1024 * 1024,

    async put(name, buffer, contentType) {
      const { put } = blobApi();
      const result = await put(`uploads/${name}`, buffer, {
        access: 'public',
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
        token: blobToken
      });
      return { name, url: result.url, size: buffer.length };
    },

    async list() {
      const { list } = blobApi();
      const result = await list({ prefix: 'uploads/', token: blobToken });
      return (result.blobs || [])
        .map((item) => ({
          name: item.pathname.replace(/^uploads\//, ''),
          url: item.url,
          size: item.size,
          createdAt: new Date(item.uploadedAt).toISOString()
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async remove(name) {
      const { del } = blobApi();
      const target = (await blobImages.list()).find((image) => image.name === name);
      if (!target) throw new Error('File not found');
      await del(target.url, { token: blobToken });
    },

    async read(name) {
      const target = (await blobImages.list()).find((image) => image.name === name);
      return target ? { redirect: target.url } : null;
    }
  };

  const redisImages = {
    limit: REDIS_IMAGE_LIMIT,

    async put(name, buffer, contentType) {
      if (buffer.length > REDIS_IMAGE_LIMIT) {
        throw new Error(
          `That image is ${Math.round(buffer.length / 1024)} KB. Without Vercel Blob connected, images are stored in Redis and have to stay under ${Math.round(REDIS_IMAGE_LIMIT / 1024)} KB.`
        );
      }
      await redis(['SET', imageKey(name), buffer.toString('base64')]);
      await redis([
        'HSET',
        IMAGE_INDEX,
        name,
        JSON.stringify({ size: buffer.length, contentType, createdAt: new Date().toISOString() })
      ]);
      return { name, url: `/uploads/${name}`, size: buffer.length };
    },

    async list() {
      const flat = await redis(['HGETALL', IMAGE_INDEX]);
      const entries = [];
      const push = (name, meta) => {
        try {
          const parsed = typeof meta === 'string' ? JSON.parse(meta) : meta;
          entries.push({ name, url: `/uploads/${name}`, ...parsed });
        } catch (_) {
          /* skip a corrupt index row */
        }
      };
      if (Array.isArray(flat)) {
        for (let i = 0; i < flat.length; i += 2) push(flat[i], flat[i + 1]);
      } else if (flat && typeof flat === 'object') {
        for (const [name, meta] of Object.entries(flat)) push(name, meta);
      }
      return entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },

    async remove(name) {
      const meta = await redis(['HGET', IMAGE_INDEX, name]);
      if (!meta) throw new Error('File not found');
      await redis(['DEL', imageKey(name)]);
      await redis(['HDEL', IMAGE_INDEX, name]);
    },

    async read(name) {
      const [encoded, meta] = await Promise.all([
        redis(['GET', imageKey(name)]),
        redis(['HGET', IMAGE_INDEX, name])
      ]);
      if (!encoded) return null;
      let contentType = 'application/octet-stream';
      try {
        const parsed = typeof meta === 'string' ? JSON.parse(meta) : meta;
        if (parsed && parsed.contentType) contentType = parsed.contentType;
      } catch (_) {
        /* fall back to the generic type */
      }
      return { buffer: Buffer.from(String(encoded), 'base64'), contentType };
    }
  };

  // Blob is the store once it exists, but images uploaded before it was
  // connected still live in Redis — so reads, listings and deletes fall back
  // there. Without this, adding Blob would silently orphan existing photos.
  const images = blobToken ? composeImageStores(blobImages, redisImages) : redisImages;

  return {
    name: 'serverless',
    description: `Redis + ${blobToken ? 'Vercel Blob for images' : 'images in Redis'}`,
    maxImageBytes: images.limit,
    ensureDirs() {},

    async readSiteDoc() {
      const raw = await redis(['GET', SITE]);
      if (!raw) return null;
      try {
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (err) {
        console.error(`[storage] stored site document was unreadable: ${err.message}`);
        return null;
      }
    },

    async writeSiteDoc(doc) {
      await redis(['SET', SITE, JSON.stringify(doc)]);
    },

    /**
     * Click counts live in their own hash and are merged in on read. A visitor
     * clicking a link can never overwrite an edit being saved at the same time.
     */
    async bumpClick(id) {
      await redis(['HINCRBY', CLICKS_KEY, id, 1]);
    },

    async applyClicks(doc) {
      const flat = await redis(['HGETALL', CLICKS_KEY]);
      const counts = {};
      if (Array.isArray(flat)) {
        for (let i = 0; i < flat.length; i += 2) counts[flat[i]] = Number(flat[i + 1]) || 0;
      } else if (flat && typeof flat === 'object') {
        for (const [key, value] of Object.entries(flat)) counts[key] = Number(value) || 0;
      }
      for (const link of doc.links.items || []) {
        const stored = Number(link.clicks) || 0;
        link.clicks = Math.max(stored, counts[link.id] || 0);
      }
      return doc;
    },

    async resetClicks() {
      await redis(['DEL', CLICKS_KEY]);
    },

    async listBackups() {
      const flat = await redis(['HGETALL', BACKUP_INDEX]);
      const entries = [];
      const push = (name, meta) => {
        try {
          entries.push({ name, ...(typeof meta === 'string' ? JSON.parse(meta) : meta) });
        } catch (_) {
          /* skip a corrupt index row */
        }
      };
      if (Array.isArray(flat)) {
        for (let i = 0; i < flat.length; i += 2) push(flat[i], flat[i + 1]);
      } else if (flat && typeof flat === 'object') {
        for (const [name, meta] of Object.entries(flat)) push(name, meta);
      }
      return entries.sort((a, b) => String(b.name).localeCompare(String(a.name)));
    },

    async readBackup(name) {
      const raw = await redis(['GET', backupKey(name)]);
      if (!raw) throw new Error('Backup not found');
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    },

    async saveBackup(name, doc) {
      const payload = JSON.stringify(doc);
      await redis(['SET', backupKey(name), payload]);
      await redis([
        'HSET',
        BACKUP_INDEX,
        name,
        JSON.stringify({ size: Buffer.byteLength(payload), createdAt: new Date().toISOString() })
      ]);
    },

    async pruneBackups(keep) {
      const backups = await this.listBackups();
      for (const old of backups.slice(keep)) {
        await redis(['DEL', backupKey(old.name)]);
        await redis(['HDEL', BACKUP_INDEX, old.name]);
      }
    },

    async readSession(token) {
      const raw = await redis(['GET', sessionKey(token)]);
      if (!raw) return null;
      try {
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (_) {
        return null;
      }
    },

    async writeSession(token, session, ttlSeconds) {
      await redis(['SETEX', sessionKey(token), Math.max(60, ttlSeconds), JSON.stringify(session)]);
    },

    async deleteSession(token) {
      await redis(['DEL', sessionKey(token)]);
    },

    async listSessions() {
      const keys = await redis(['KEYS', sessionKey('*')]);
      if (!Array.isArray(keys) || !keys.length) return [];
      const values = await redis(['MGET', ...keys]);
      return keys
        .map((key, i) => {
          const raw = Array.isArray(values) ? values[i] : null;
          if (!raw) return null;
          try {
            const session = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return { token: key.slice(sessionKey('').length), ...session };
          } catch (_) {
            return null;
          }
        })
        .filter(Boolean);
    },

    async clearSessions() {
      const keys = await redis(['KEYS', sessionKey('*')]);
      if (Array.isArray(keys) && keys.length) await redis(['DEL', ...keys]);
    },

    putImage: (name, buffer, contentType) => images.put(name, buffer, contentType),
    listImages: () => images.list(),
    deleteImage: (name) => images.remove(name),
    readImage: (name) => images.read(name)
  };
}

// --------------------------------------------------------------- github

/**
 * The repository itself as the datastore, through the Contents API.
 *
 * This exists because it needs nothing but a GitHub token: no database, no
 * object store, no paid tier. Every save is a commit, so the site's history is
 * the backup list and any past version can be restored.
 *
 * Two consequences worth knowing:
 *   - Sessions cannot live here (a commit per sign-in would be absurd), so this
 *     backend signs them instead — see `statelessSessions`.
 *   - Click counts are per-instance and best-effort, for the same reason.
 */
function createGithubBackend(config) {
  const { token, owner, repo, branch, contentPath, uploadDir } = config;
  // Content lives on the same branch the site deploys from, and is read live
  // through the API — so a content commit must not trigger a rebuild. Vercel,
  // GitHub Actions and most CI honour this marker.
  const SKIP_CI = '[skip ci]';
  const API = (config.apiBase || 'https://api.github.com').replace(/\/+$/, '');
  const CACHE_MS = Number.isFinite(config.cacheMs) ? config.cacheMs : 15000;

  let cached = null; // { doc, sha, at }
  const clicks = new Map();

  async function gh(pathname, options = {}) {
    const res = await fetch(API + pathname, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'taylosite',
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (res.status === 404) return null;
    const text = await res.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (_) {
      /* fall through to the error below */
    }
    if (!res.ok) {
      const detail = (payload && payload.message) || res.statusText;
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `GitHub rejected the request (${res.status}: ${detail}). Check that GITHUB_TOKEN is valid and has Contents: read and write on ${owner}/${repo}.`
        );
      }
      if (res.status === 409) {
        throw new Error('The repository changed while saving. Reload the admin panel and save again.');
      }
      throw new Error(`GitHub ${res.status}: ${detail}`);
    }
    return payload;
  }

  const decode = (content) => Buffer.from(String(content || '').replace(/\s/g, ''), 'base64');

  async function getFile(path, ref = branch) {
    const found = await gh(`/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`);
    if (!found || Array.isArray(found)) return null;
    if (!found.content && found.size > 0) {
      throw new Error(`${path} is too large to read through the Contents API (${found.size} bytes).`);
    }
    return { buffer: decode(found.content), sha: found.sha, size: found.size };
  }

  async function putFile(path, buffer, message, sha) {
    const result = await gh(`/repos/${owner}/${repo}/contents/${encodeURI(path)}`, {
      method: 'PUT',
      body: {
        message,
        content: buffer.toString('base64'),
        branch,
        ...(sha ? { sha } : {})
      }
    });
    return result && result.content ? result.content.sha : null;
  }

  async function deleteFile(path, message) {
    const existing = await getFile(path);
    if (!existing) throw new Error('File not found');
    await gh(`/repos/${owner}/${repo}/contents/${encodeURI(path)}`, {
      method: 'DELETE',
      body: { message, sha: existing.sha, branch }
    });
  }

  return {
    name: 'github',
    description: `GitHub repository ${owner}/${repo}@${branch}`,
    statelessSessions: true,
    // The Contents API returns inline content only below 1 MB.
    maxImageBytes: 900 * 1024,
    ensureDirs() {},

    async readSiteDoc() {
      if (cached && Date.now() - cached.at < CACHE_MS) return JSON.parse(JSON.stringify(cached.doc));
      const file = await getFile(contentPath);
      if (!file) {
        cached = null;
        return null;
      }
      let doc;
      try {
        doc = JSON.parse(file.buffer.toString('utf8'));
      } catch (err) {
        throw new Error(`${contentPath} in ${owner}/${repo} is not valid JSON: ${err.message}`);
      }
      cached = { doc, sha: file.sha, at: Date.now() };
      return JSON.parse(JSON.stringify(doc));
    },

    async writeSiteDoc(doc) {
      // Always resolve the current sha first: another instance may have written.
      const existing = await getFile(contentPath);
      const sha = await putFile(
        contentPath,
        Buffer.from(JSON.stringify(doc, null, 2)),
        `Update site content from the admin panel ${SKIP_CI}`,
        existing ? existing.sha : undefined
      );
      cached = { doc: JSON.parse(JSON.stringify(doc)), sha, at: Date.now() };
    },

    async bumpClick(id) {
      clicks.set(id, (clicks.get(id) || 0) + 1);
    },

    async applyClicks(doc) {
      for (const link of doc.links.items || []) {
        const extra = clicks.get(link.id) || 0;
        if (extra) link.clicks = (Number(link.clicks) || 0) + extra;
      }
      return doc;
    },

    /** Commits touching the content file are the snapshot list. */
    async listBackups() {
      const commits = await gh(
        `/repos/${owner}/${repo}/commits?path=${encodeURIComponent(contentPath)}&sha=${encodeURIComponent(branch)}&per_page=30`
      );
      if (!Array.isArray(commits)) return [];
      return commits.slice(1).map((entry) => ({
        name: `site-${entry.sha}.json`,
        size: 0,
        createdAt: ((entry.commit || {}).committer || {}).date || ((entry.commit || {}).author || {}).date || '',
        message: (entry.commit || {}).message || ''
      }));
    },

    async readBackup(name) {
      const ref = String(name).replace(/^site-/, '').replace(/\.json$/, '');
      if (!/^[0-9a-f]{7,40}$/.test(ref)) throw new Error('Invalid snapshot reference');
      const file = await getFile(contentPath, ref);
      if (!file) throw new Error('Backup not found');
      return JSON.parse(file.buffer.toString('utf8'));
    },

    // Git keeps the history; there is nothing to write or prune.
    async saveBackup() {},
    async pruneBackups() {},

    // Sessions are signed rather than stored — see lib/auth.js.
    async readSession() {
      return null;
    },
    async writeSession() {},
    async deleteSession() {},
    async listSessions() {
      return [];
    },
    async clearSessions() {},

    async putImage(name, buffer, contentType) {
      if (buffer.length > this.maxImageBytes) {
        throw new Error(
          `That image is ${Math.round(buffer.length / 1024)} KB. Images committed to the repository have to stay under ${Math.round(this.maxImageBytes / 1024)} KB.`
        );
      }
      await putFile(`${uploadDir}/${name}`, buffer, `Add ${name} from the admin panel ${SKIP_CI}`);
      return { name, url: `/uploads/${name}`, size: buffer.length, contentType };
    },

    async listImages() {
      const entries = await gh(
        `/repos/${owner}/${repo}/contents/${encodeURI(uploadDir)}?ref=${encodeURIComponent(branch)}`
      );
      if (!Array.isArray(entries)) return [];
      return entries
        .filter((entry) => entry.type === 'file' && !entry.name.startsWith('.'))
        .map((entry) => ({
          name: entry.name,
          url: `/uploads/${entry.name}`,
          size: entry.size,
          createdAt: ''
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async deleteImage(name) {
      await deleteFile(`${uploadDir}/${name}`, `Delete ${name} from the admin panel ${SKIP_CI}`);
    },

    async readImage(name) {
      const file = await getFile(`${uploadDir}/${name}`);
      if (!file) return null;
      const ext = path.extname(name).toLowerCase();
      const types = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.avif': 'image/avif',
        '.svg': 'image/svg+xml'
      };
      return { buffer: file.buffer, contentType: types[ext] || 'application/octet-stream' };
    }
  };
}

// ------------------------------------------------------------------ chooser

function detectConfig(env = process.env) {
  const redisUrl = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || env.REDIS_REST_API_URL;
  const redisToken = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || env.REDIS_REST_API_TOKEN;
  return { redisUrl, redisToken, blobToken: env.BLOB_READ_WRITE_TOKEN };
}

function detectGithubConfig(env = process.env) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  // Vercel exposes the connected repository, so the slug usually needs no setup.
  const slug =
    env.GITHUB_REPO ||
    (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG
      ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}`
      : '');
  const [owner, repo] = String(slug).split('/');
  return {
    token,
    owner,
    repo,
    branch: env.GITHUB_BRANCH || env.VERCEL_GIT_COMMIT_REF || 'main',
    contentPath: env.GITHUB_CONTENT_PATH || 'data/site.json',
    uploadDir: env.GITHUB_UPLOAD_DIR || 'data/uploads',
    apiBase: env.GITHUB_API_URL || 'https://api.github.com'
  };
}

function createBackend(env = process.env) {
  const config = detectConfig(env);

  // Upstash shows both a redis:// connection string and a REST URL. Only the
  // REST one works over HTTP, and pasting the wrong one is an easy mistake to
  // make — so name it rather than failing with "fetch failed".
  if (config.redisUrl && !/^https?:\/\//i.test(config.redisUrl)) {
    throw new Error(
      `The Redis URL must be the REST URL, which starts with https:// and usually ends in .upstash.io — got "${config.redisUrl.slice(0, 24)}…". ` +
        'Copy the value labelled REST URL (or UPSTASH_REDIS_REST_URL), not the redis:// connection string.'
    );
  }
  if (config.redisUrl && !config.redisToken) {
    throw new Error('A Redis URL is set but its token is missing. Add UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_TOKEN) and redeploy.');
  }
  if (config.redisToken && !config.redisUrl) {
    throw new Error('A Redis token is set but its URL is missing. Add UPSTASH_REDIS_REST_URL (or KV_REST_API_URL) and redeploy.');
  }

  if (config.redisUrl && config.redisToken) return createServerlessBackend(config);

  // A GITHUB_TOKEN in the environment is common for unrelated reasons, so it
  // alone must never redirect a machine that has a perfectly good disk. This
  // backend engages where there is no filesystem to speak of, or on request.
  const github = detectGithubConfig(env);
  const wantsGithub = env.TAYLOSITE_STORAGE === 'github' || (Boolean(env.VERCEL) && Boolean(github.token));
  if (wantsGithub) {
    if (!github.token) {
      throw new Error('Storage is set to github but GITHUB_TOKEN is missing.');
    }
    if (!github.owner || !github.repo) {
      throw new Error(
        'GITHUB_TOKEN is set but the repository is unknown. Add GITHUB_REPO in the form owner/name and redeploy.'
      );
    }
    return createGithubBackend(github);
  }

  if (env.VERCEL) {
    // Failing loudly beats a site that looks fine until the first save.
    const blobOnly = config.blobToken
      ? 'Vercel Blob is connected here, but Blob only stores images — the site\'s text, links and dates need one of the two below as well. '
      : '';
    throw new Error(
      `${blobOnly}This deployment has nowhere to store content. Either add GITHUB_TOKEN so the site keeps its ` +
        'content in this repository (no other service needed), or connect a Redis store which sets ' +
        'KV_REST_API_URL and KV_REST_API_TOKEN. Environment variables apply per environment, so make sure they ' +
        'are ticked for this one, then redeploy. See README → Deploying to Vercel.'
    );
  }
  return createFilesystemBackend();
}

module.exports = {
  createBackend,
  createFilesystemBackend,
  createServerlessBackend,
  createGithubBackend,
  composeImageStores,
  detectConfig,
  detectGithubConfig
};
