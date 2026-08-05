'use strict';

/**
 * A stand-in for the slice of GitHub's Contents API the github backend uses, so
 * that path is executed for real in tests instead of mocked at the call site.
 * Keeps an in-memory tree of files plus a commit log per path.
 */
const http = require('http');
const crypto = require('crypto');

function startFakeGithub({ token = 'ghp_test', owner = 'acme', repo = 'site' } = {}) {
  const files = new Map(); // path -> { buffer, sha }
  const commits = new Map(); // path -> [{ sha, date, message }]

  const shaOf = (buffer) => crypto.createHash('sha1').update(buffer).digest('hex');

  function record(path, message) {
    const sha = crypto.randomBytes(20).toString('hex');
    const log = commits.get(path) || [];
    // Newest first, like the real API.
    log.unshift({ sha, date: new Date(Date.now() + log.length).toISOString(), message });
    commits.set(path, log);
    // A commit is a point-in-time copy, addressable by its sha.
    const current = files.get(path);
    if (current) files.set(`${path}@${sha}`, { buffer: Buffer.from(current.buffer), sha: current.sha });
    return sha;
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const reply = (status, body) => {
      const payload = body === undefined ? '' : JSON.stringify(body);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(payload);
    };

    if (req.headers.authorization !== `Bearer ${token}`) {
      return reply(401, { message: 'Bad credentials' });
    }

    const prefix = `/repos/${owner}/${repo}/`;
    if (!url.pathname.startsWith(prefix)) return reply(404, { message: 'Not Found' });
    const rest = url.pathname.slice(prefix.length);

    // GET /commits?path=&sha=
    if (rest === 'commits') {
      const path = url.searchParams.get('path');
      const log = commits.get(path) || [];
      return reply(
        200,
        log.map((entry) => ({
          sha: entry.sha,
          commit: { message: entry.message, committer: { date: entry.date } }
        }))
      );
    }

    if (!rest.startsWith('contents/')) return reply(404, { message: 'Not Found' });
    const target = decodeURIComponent(rest.slice('contents/'.length));

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};

      if (req.method === 'GET') {
        const ref = url.searchParams.get('ref');
        const versioned = ref && files.has(`${target}@${ref}`) ? `${target}@${ref}` : target;
        const file = files.get(versioned);
        if (file) {
          return reply(200, {
            type: 'file',
            name: target.split('/').pop(),
            path: target,
            sha: file.sha,
            size: file.buffer.length,
            content: file.buffer.toString('base64')
          });
        }
        // Maybe it is a directory listing.
        const children = [...files.keys()].filter((key) => !key.includes('@') && key.startsWith(`${target}/`));
        if (children.length) {
          return reply(
            200,
            children.map((key) => ({
              type: 'file',
              name: key.slice(target.length + 1),
              path: key,
              sha: files.get(key).sha,
              size: files.get(key).buffer.length
            }))
          );
        }
        return reply(404, { message: 'Not Found' });
      }

      if (req.method === 'PUT') {
        const existing = files.get(target);
        if (existing && parsed.sha && parsed.sha !== existing.sha) {
          return reply(409, { message: 'sha does not match' });
        }
        const buffer = Buffer.from(parsed.content, 'base64');
        files.set(target, { buffer, sha: shaOf(buffer) });
        record(target, parsed.message || 'update');
        return reply(existing ? 200 : 201, { content: { sha: files.get(target).sha, path: target } });
      }

      if (req.method === 'DELETE') {
        if (!files.has(target)) return reply(404, { message: 'Not Found' });
        files.delete(target);
        record(target, parsed.message || 'delete');
        return reply(200, { commit: {} });
      }

      return reply(405, { message: 'Method Not Allowed' });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        api: `http://127.0.0.1:${server.address().port}`,
        token,
        owner,
        repo,
        files,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

module.exports = { startFakeGithub };
