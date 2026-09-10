'use strict';

const http = require('node:http');

/**
 * A stand-in for the Anthropic Messages API, so the flyer path runs for real —
 * key check, image block, structured-output request and all — without a live
 * key. `answer` is the object the "model" hands back; `state` makes it
 * misbehave the ways the real service does.
 */
async function startFakeAnthropic({ answer = {}, state = {} } = {}) {
  const calls = [];

  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    let json = null;
    try {
      json = JSON.parse(body);
    } catch (_) {
      /* not JSON */
    }
    calls.push({ path: req.url, method: req.method, key: req.headers['x-api-key'] || null, body: json });

    const reply = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (req.url !== '/v1/messages' || req.method !== 'POST') {
      return reply(404, { type: 'error', error: { type: 'not_found_error', message: 'Not found' } });
    }
    if (state.down) return reply(500, { type: 'error', error: { type: 'api_error', message: 'Internal server error' } });
    if (!req.headers['x-api-key'] || state.badKey) {
      return reply(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    }
    if (state.rateLimited) return reply(429, { type: 'error', error: { type: 'rate_limit_error', message: 'Too many requests' } });
    if (state.refuse) {
      return reply(200, {
        id: 'msg_refused',
        type: 'message',
        role: 'assistant',
        model: json.model,
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: null, explanation: 'declined' },
        usage: { input_tokens: 1, output_tokens: 0 }
      });
    }
    const text = state.garbage ? 'not json at all' : JSON.stringify(answer);
    return reply(200, {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: json.model,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 80 }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    calls,
    state,
    stop: () => new Promise((resolve) => server.close(resolve))
  };
}

module.exports = { startFakeAnthropic };
