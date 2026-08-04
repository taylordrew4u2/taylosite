'use strict';

/**
 * Where the site's data actually lives.
 *
 * Two backends, chosen automatically from the environment:
 *
 *   filesystem   the default — a `data/` directory. Used locally, on a VPS, or
 *                anywhere with a real disk.
 *   serverless   Redis (Upstash, via Vercel's marketplace integration) for the
 *                site document, sessions and backups, plus Vercel Blob for
 *                uploaded images. Used on Vercel, where the filesystem is
 *                read-only and per-instance.
 *
 * Everything is async so both backends can share one interface:
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

  const images = blobToken ? blobImages : redisImages;

  return {
    name: 'serverless',
    description: `Redis + ${blobToken ? 'Vercel Blob' : 'images in Redis'}`,
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

// ------------------------------------------------------------------ chooser

function detectConfig(env = process.env) {
  const redisUrl = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || env.REDIS_REST_API_URL;
  const redisToken = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || env.REDIS_REST_API_TOKEN;
  return { redisUrl, redisToken, blobToken: env.BLOB_READ_WRITE_TOKEN };
}

function createBackend(env = process.env) {
  const config = detectConfig(env);
  if (config.redisUrl && config.redisToken) return createServerlessBackend(config);

  if (env.VERCEL) {
    // Failing loudly beats a site that looks fine until the first save.
    throw new Error(
      'Running on Vercel without a Redis store. Add the Upstash Redis integration to this project ' +
        '(it sets KV_REST_API_URL and KV_REST_API_TOKEN) and redeploy. See README → Deploying to Vercel.'
    );
  }
  return createFilesystemBackend();
}

module.exports = { createBackend, createFilesystemBackend, createServerlessBackend, detectConfig };
