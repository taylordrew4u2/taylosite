'use strict';

/**
 * A stand-in for Upstash's REST API — enough of it to exercise the serverless
 * storage backend without a real Redis. Commands arrive as a JSON array in the
 * body and the reply is `{ result }` or `{ error }`, same as the real thing.
 */
const http = require('http');

function startFakeRedis(token = 'test-token') {
  const strings = new Map();
  const hashes = new Map();
  const expiries = new Map();

  function alive(key) {
    const exp = expiries.get(key);
    if (exp && exp < Date.now()) {
      strings.delete(key);
      hashes.delete(key);
      expiries.delete(key);
      return false;
    }
    return true;
  }

  function hash(key) {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key);
  }

  function glob(pattern) {
    const rx = new RegExp(
      '^' + pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'
    );
    return [...strings.keys()].filter((k) => alive(k) && rx.test(k));
  }

  function run(args) {
    const cmd = String(args[0]).toUpperCase();
    const key = args[1];
    switch (cmd) {
      case 'GET':
        return alive(key) && strings.has(key) ? strings.get(key) : null;
      case 'SET':
        strings.set(key, args[2]);
        expiries.delete(key);
        return 'OK';
      case 'SETEX':
        strings.set(key, args[3]);
        expiries.set(key, Date.now() + Number(args[2]) * 1000);
        return 'OK';
      case 'DEL': {
        let n = 0;
        for (const k of args.slice(1)) {
          if (strings.delete(k)) n++;
          if (hashes.delete(k)) n++;
          expiries.delete(k);
        }
        return n;
      }
      case 'KEYS':
        return glob(key);
      case 'MGET':
        return args.slice(1).map((k) => (alive(k) && strings.has(k) ? strings.get(k) : null));
      case 'HSET': {
        const h = hash(key);
        for (let i = 2; i < args.length; i += 2) h.set(args[i], args[i + 1]);
        return 1;
      }
      case 'HGET': {
        const h = hash(key);
        return h.has(args[2]) ? h.get(args[2]) : null;
      }
      case 'HDEL': {
        const h = hash(key);
        let n = 0;
        for (const f of args.slice(2)) if (h.delete(f)) n++;
        return n;
      }
      case 'HGETALL': {
        const out = [];
        for (const [f, v] of hash(key)) out.push(f, v);
        return out;
      }
      case 'HINCRBY': {
        const h = hash(key);
        const next = (Number(h.get(args[2])) || 0) + Number(args[3]);
        h.set(args[2], String(next));
        return next;
      }
      default:
        throw new Error(`unsupported command ${cmd}`);
    }
  }

  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'unauthorized' }));
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let payload;
      try {
        payload = { result: run(JSON.parse(body)) };
      } catch (err) {
        payload = { error: err.message };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        token,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

module.exports = { startFakeRedis };
