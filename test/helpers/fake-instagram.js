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
    let body = '';
    if (req.method === 'POST') {
      for await (const chunk of req) body += chunk;
    }
    const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
    calls.push({
      path: url.pathname,
      method: req.method,
      token: url.searchParams.get('access_token') || (bearer ? bearer[1] : null),
      auth: req.headers.authorization || null,
      fields: url.searchParams.get('fields'),
      grant: url.searchParams.get('grant_type'),
      body
    });

    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (state.down) return json(500, { error: { message: 'Internal server error' } });
    if (state.hangMs) await new Promise((r) => setTimeout(r, state.hangMs));

    // The Send API carries its token in the Authorization header; everything
    // else puts it in the query string.
    if (!url.searchParams.get('access_token') && !bearer && url.pathname !== '/oauth/access_token') {
      return json(400, { error: { message: 'Missing access token' } });
    }
    if (state.expired) {
      return json(401, { error: { message: 'Error validating access token: Session has expired' } });
    }

    // The token dance: code -> short-lived -> long-lived -> refreshed.
    if (url.pathname === '/oauth/access_token') {
      return json(200, { data: [{ access_token: 'short-token', user_id: '1020', permissions: 'instagram_business_basic' }] });
    }
    if (url.pathname === '/access_token') {
      if (url.searchParams.get('grant_type') !== 'ig_exchange_token') {
        return json(400, { error: { message: 'Bad grant_type' } });
      }
      return json(200, { access_token: 'long-token', token_type: 'bearer', expires_in: 5183944 });
    }
    if (url.pathname === '/refresh_access_token') {
      if (url.searchParams.get('grant_type') !== 'ig_refresh_token') {
        return json(400, { error: { message: 'Bad grant_type' } });
      }
      if (state.refuseRefresh) return json(400, { error: { message: 'Cannot refresh' } });
      return json(200, { access_token: 'refreshed-token', token_type: 'bearer', expires_in: 5183944 });
    }

    // POST /v25.0/<user>/messages — a direct message.
    const send = /^\/v\d+\.\d+\/([^/]+)\/messages$/.exec(url.pathname);
    if (send) {
      if (req.method !== 'POST') return json(405, { error: { message: 'Must be POST' } });
      if (!bearer) return json(400, { error: { message: 'An access token is required to request this resource.' } });
      if (state.outsideWindow) {
        return json(400, {
          error: {
            message:
              'This message is sent outside of allowed window. Please read the policy: https://developers.facebook.com/docs/messenger-platform/policy/policy-overview'
          }
        });
      }
      let payload = {};
      try {
        payload = JSON.parse(body || '{}');
      } catch (_) {
        return json(400, { error: { message: 'Malformed JSON' } });
      }
      const to = payload && payload.recipient && payload.recipient.id;
      if (!to) return json(400, { error: { message: 'Param recipient is required' } });
      if (!(payload.message && payload.message.text)) {
        return json(400, { error: { message: 'Param message is required' } });
      }
      return json(200, { recipient_id: String(to), message_id: 'mid.fake-1' });
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
