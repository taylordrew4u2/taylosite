'use strict';

const fs = require('fs');
const path = require('path');
const { defaultSite } = require('./defaults');

const DATA_DIR = process.env.TAYLOSITE_DATA_DIR
  ? path.resolve(process.env.TAYLOSITE_DATA_DIR)
  : path.join(__dirname, '..', 'data');

const SITE_FILE = path.join(DATA_DIR, 'site.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MAX_BACKUPS = 30;

function ensureDirs() {
  for (const dir of [DATA_DIR, BACKUP_DIR, UPLOAD_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

let cache = null;

function readSite() {
  if (cache) return cache;
  ensureDirs();
  if (fs.existsSync(SITE_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(SITE_FILE, 'utf8'));
      return cache;
    } catch (err) {
      // A corrupt file should not take the site down: keep it for forensics
      // and start again from defaults.
      const wrecked = path.join(BACKUP_DIR, `corrupt-${Date.now()}.json`);
      try {
        fs.copyFileSync(SITE_FILE, wrecked);
      } catch (_) {
        /* best effort */
      }
      console.error(`[store] site.json was unreadable (${err.message}); saved a copy at ${wrecked}`);
    }
  }
  cache = defaultSite();
  writeSite(cache, { backup: false });
  return cache;
}

function writeSite(site, { backup = true } = {}) {
  ensureDirs();
  if (backup && fs.existsSync(SITE_FILE)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      fs.copyFileSync(SITE_FILE, path.join(BACKUP_DIR, `site-${stamp}.json`));
      pruneBackups();
    } catch (err) {
      console.error(`[store] backup failed: ${err.message}`);
    }
  }
  const tmp = `${SITE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(site, null, 2));
  fs.renameSync(tmp, SITE_FILE);
  cache = site;
  return site;
}

function listBackups() {
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
}

function readBackup(name) {
  if (!/^site-[\w.-]+\.json$/.test(name)) throw new Error('Invalid backup name');
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) throw new Error('Backup not found');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function pruneBackups() {
  const backups = listBackups();
  for (const old of backups.slice(MAX_BACKUPS)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, old.name));
    } catch (_) {
      /* best effort */
    }
  }
}

function listUploads() {
  ensureDirs();
  return fs
    .readdirSync(UPLOAD_DIR)
    .filter((name) => !name.startsWith('.'))
    .map((name) => {
      const stat = fs.statSync(path.join(UPLOAD_DIR, name));
      return { name, url: `/uploads/${name}`, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function deleteUpload(name) {
  if (!/^[\w.-]+$/.test(name) || name.includes('..')) throw new Error('Invalid file name');
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) throw new Error('File not found');
  fs.unlinkSync(file);
}

/** Mutate + persist in one step so concurrent handlers cannot interleave. */
function update(mutator, options = {}) {
  const site = JSON.parse(JSON.stringify(readSite()));
  const next = mutator(site) || site;
  return writeSite(next, options);
}

module.exports = {
  DATA_DIR,
  SITE_FILE,
  BACKUP_DIR,
  UPLOAD_DIR,
  ensureDirs,
  readSite,
  writeSite,
  update,
  listBackups,
  readBackup,
  listUploads,
  deleteUpload
};
