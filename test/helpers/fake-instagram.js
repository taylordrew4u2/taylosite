'use strict';

const http = require('node:http');

/**
 * A stand-in for the Instagram Graph API, so the reel-fetching path runs for
 * real — token check, field selection, paging shape and all — without needing
 * an account or a live token.
 *
 * `state` lets a test make the account misbehave the ways a real one does: an
 * expired token, a slow answer, an outage.
 */
async function startFakeInstagram({ media = [], state = {} } = {}) {
  const calls = [];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    calls.push({ path: url.pathname, token: url.searchParams.get('access_token'), fields: url.searchParams.get('fields') });

    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (state.down) return json(500, { error: { message: 'Internal server error' } });
    if (state.hangMs) await new Promise((r) => setTimeout(r, state.hangMs));

    if (!url.searchParams.get('access_token')) {
      return json(400, { error: { message: 'Missing access token' } });
    }
    if (state.expired) {
      return json(401, { error: { message: 'Error validating access token: Session has expired' } });
    }

    const match = /^\/([^/]+)\/media$/.exec(url.pathname);
    if (!match) return json(404, { error: { message: 'Unsupported get request' } });

    const limit = Number(url.searchParams.get('limit')) || 25;
    return json(200, { data: media.slice(0, limit), paging: { cursors: { before: 'a', after: 'b' } } });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    base: `http://127.0.0.1:${port}`,
    calls,
    state,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

module.exports = { startFakeInstagram };
