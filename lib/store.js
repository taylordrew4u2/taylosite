'use strict';

const { createBackend } = require('./storage');
const { defaultSite } = require('./defaults');

const MAX_BACKUPS = 30;

let backend = null;
function store() {
  if (!backend) backend = createBackend();
  return backend;
}

/**
 * One in-flight write at a time. Serverless instances still race each other —
 * that is what the optimistic `expectedUpdatedAt` check on save is for — but
 * within an instance nothing interleaves.
 */
let queue = Promise.resolve();
function serialize(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

async function readSite() {
  const doc = (await store().readSiteDoc()) || (await writeSite(defaultSite(), { backup: false }));
  return store().applyClicks ? store().applyClicks(doc) : doc;
}

async function writeSite(site, { backup = true } = {}) {
  if (backup) {
    const previous = await store().readSiteDoc();
    if (previous) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      try {
        await store().saveBackup(`site-${stamp}.json`, previous);
        await store().pruneBackups(MAX_BACKUPS);
      } catch (err) {
        console.error(`[store] backup failed: ${err.message}`);
      }
    }
  }
  await store().writeSiteDoc(site);
  return site;
}

/** Read, mutate and persist without another handler slipping in between. */
function update(mutator, options = {}) {
  return serialize(async () => {
    const site = await readSite();
    const next = (await mutator(site)) || site;
    return writeSite(next, options);
  });
}

function save(site, options = {}) {
  return serialize(() => writeSite(site, options));
}

async function listBackups() {
  return store().listBackups();
}

async function readBackup(name) {
  if (!/^site-[\w.-]+\.json$/.test(name)) throw new Error('Invalid backup name');
  return store().readBackup(name);
}

async function listUploads() {
  return store().listImages();
}

async function putUpload(name, buffer, contentType) {
  return store().putImage(name, buffer, contentType);
}

async function deleteUpload(name) {
  if (!/^[\w.-]+$/.test(name) || name.includes('..')) throw new Error('Invalid file name');
  return store().deleteImage(name);
}

async function readUpload(name) {
  if (!/^[\w.-]+$/.test(name) || name.includes('..')) return null;
  return store().readImage(name);
}

async function bumpClick(id) {
  return store().bumpClick(id);
}

async function resetClicks() {
  if (store().resetClicks) await store().resetClicks();
  return update((site) => {
    site.links.items = (site.links.items || []).map((item) => ({ ...item, clicks: 0 }));
    return site;
  });
}

const sessions = {
  read: (token) => store().readSession(token),
  write: (token, session, ttlSeconds) => store().writeSession(token, session, ttlSeconds),
  remove: (token) => store().deleteSession(token),
  list: () => store().listSessions(),
  clear: () => store().clearSessions()
};

function ensureDirs() {
  store().ensureDirs();
}

/** True when the backend cannot hold session records, so they get signed. */
function statelessSessions() {
  try {
    return Boolean(store().statelessSessions);
  } catch (_) {
    return false;
  }
}

function maxImageBytes() {
  try {
    return store().maxImageBytes || 8 * 1024 * 1024;
  } catch (_) {
    return 8 * 1024 * 1024;
  }
}

/** Never throws — it is used in status output and error pages. */
function describe() {
  try {
    return store().description;
  } catch (err) {
    return `unavailable — ${err.message}`;
  }
}

module.exports = {
  ensureDirs,
  describe,
  maxImageBytes,
  statelessSessions,
  readSite,
  writeSite: save,
  update,
  listBackups,
  readBackup,
  listUploads,
  putUpload,
  deleteUpload,
  readUpload,
  bumpClick,
  resetClicks,
  sessions,
  MAX_BACKUPS
};
