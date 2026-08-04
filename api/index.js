'use strict';

/**
 * Vercel entrypoint.
 *
 * `server.js` exports a plain http.Server and only calls `.listen()` when it is
 * run directly, so here we hand each serverless invocation to its request
 * listeners. The same code therefore runs unchanged locally, on a VPS and on
 * Vercel.
 */
const server = require('../server.js');

module.exports = (req, res) => {
  server.emit('request', req, res);
};
