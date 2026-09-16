'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const { EventEmitter } = require('node:events');
const ai = require('../lib/ai-providers');
const { startFakeAnthropic } = require('./helpers/fake-anthropic');
const request = { max_tokens: 512, output_config: { format: { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } } } }, messages: [{ role: 'user', content: 'Return JSON for SEO + GEO.' }] };

async function fakeChat(run) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    calls.push({ path: req.url, body: JSON.parse(raw), authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"Combined copy"}' } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`, calls); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('rate limited primary falls back once to saved OpenAI without leaking keys', async () => {
  const primary = await startFakeAnthropic({ state: { rateLimited: true } });
  try {
    await fakeChat(async (base, calls) => {
      const site = { auth: { anthropic: { apiKey: 'sk-ant-primary-0123456789' }, aiProviders: { openai: { apiKey: 'openai-backup-0123456789', model: 'vision-model' } } } };
      const result = await ai.create({ site, env: { AI_HOSTED_ENABLED: 'true', ANTHROPIC_BASE_URL: primary.base, OPENAI_BASE_URL: base }, request });
      assert.equal(JSON.parse(result.content[0].text).text, 'Combined copy');
      assert.equal(primary.calls.length, 1);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].path, '/chat/completions');
      assert.equal(calls[0].body.model, 'vision-model');
      assert.equal(calls[0].authorization, 'Bearer openai-backup-0123456789');
      assert.doesNotMatch(JSON.stringify(ai.status(site, {})), /0123456789/);
    });
  } finally { await primary.stop(); }
});

test('preferred Gemini supports photo payloads and bypasses other providers', async () => {
  await fakeChat(async (base, calls) => {
    const site = { auth: { aiPrimary: 'gemini', anthropic: { apiKey: 'unused-key' }, aiProviders: { gemini: { apiKey: 'gemini-key' } } } };
    await ai.create({ site, env: { AI_HOSTED_ENABLED: 'true', GEMINI_BASE_URL: base }, request: { ...request, messages: [{ role: 'user', content: [{ type: 'image', source: { media_type: 'image/png', data: 'aGVsbG8=' } }, { type: 'text', text: 'Describe this photo.' }] }] } });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body.messages[1].content[0], { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } });
  });
});

test('saving, selecting and removing keys preserves legacy and environment credentials', async () => {
  let site = { auth: { anthropic: { apiKey: 'sk-ant-existing-0123456789' } } };
  const store = { update: async fn => { site = fn(site); } };
  await ai.save({ store, provider: 'anthropic', model: 'custom-model', primary: true });
  assert.equal(ai.configurations(site, {})[0].key, 'sk-ant-existing-0123456789');
  await ai.save({ store, provider: 'openai', apiKey: 'sk-openai-0123456789abcdef', primary: true });
  assert.equal(ai.status(site, {}).primary, 'openai');
  await ai.save({ store, provider: 'openai', model: 'another-model' });
  assert.equal(ai.configurations(site, {})[0].key, 'sk-openai-0123456789abcdef');
  await ai.remove({ store, provider: 'openai' });
  assert.equal(ai.status(site, {}).primary, 'anthropic');
  await ai.remove({ store, provider: 'anthropic' });
  assert.equal(ai.status(site, {}).configured, false);
  assert.equal(ai.status(site, { OPENAI_API_KEY: 'server-key' }).configured, true);
  await assert.rejects(ai.save({ store, provider: '__proto__', apiKey: 'secret' }), /supported/);
});


test('default free mode makes no hosted calls even when paid keys exist', async () => {
  const provider = await startFakeAnthropic({});
  try {
    await assert.rejects(ai.create({ site: { auth: { anthropic: { apiKey: 'sk-ant-existing-0123456789' } } }, env: { ANTHROPIC_BASE_URL: provider.base }, request }), /Hosted AI is disabled/);
    assert.equal(provider.calls.length, 0);
  } finally { await provider.stop(); }
});

function memoryStore(initial = {}) {
  let site = initial;
  return { read: () => site, update: async (fn) => { site = fn(site); } };
}

async function startChat(state = {}) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    calls.push({ path: req.url, body: JSON.parse(raw), headers: req.headers });
    if (state.disconnect) return req.socket.destroy();
    if (state.stall) return;
    res.writeHead(state.status || 200, { 'Content-Type': 'application/json', ...(state.headers || {}) });
    res.end(state.raw || JSON.stringify(state.response || { choices: [{ finish_reason: 'stop', message: { content: '{"text":"Useful varied copy"}' } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, calls, stop: () => new Promise((resolve) => server.close(resolve)) };
}

test('custom APIs keep keys private, preserve blank key edits and use an explicit ordered mode', async () => {
  const store = memoryStore();
  const first = await ai.save({ store, provider: 'custom', label: 'My primary', apiKey: 'primary-secret', model: 'org/model-one', baseUrl: 'https://api.example.com/v1/' });
  const id = first.providers.find((p) => p.label === 'My primary').id;
  assert.match(id, /^custom-/);
  assert.equal(first.mode, 'browser', 'saving credentials does not opt into hosted calls');
  assert.equal(first.providers.find((p) => p.id === id).baseUrl, 'https://api.example.com/v1');
  assert.doesNotMatch(JSON.stringify(first), /primary-secret/);
  await ai.save({ store, provider: id, apiKey: '', model: 'org/model-two' });
  assert.equal(ai.configurations(store.read(), {})[0].key, 'primary-secret');
  await ai.save({ store, provider: 'custom', id: 'backup', label: 'Backup', protocol: 'anthropic', apiKey: 'backup-secret', model: 'backup-model', baseUrl: 'https://backup.example.com/v1/messages' });
  await ai.configure({ store, mode: 'hosted', order: ['backup', id] });
  assert.equal(ai.status(store.read(), {}).mode, 'hosted');
  assert.deepEqual(ai.configurations(store.read(), {}).map((p) => p.id), ['backup', id]);
  await ai.save({ store, provider: 'backup', enabled: false });
  assert.equal(ai.status(store.read(), {}).primary, id);
  assert.equal(ai.status(store.read(), {}).providers.find((p) => p.id === 'backup').configured, true);
  await ai.configure({ store, mode: 'browser' });
  assert.equal(ai.status(store.read(), { AI_HOSTED_ENABLED: 'true' }).mode, 'browser');
  await ai.remove({ store, provider: 'backup' });
  assert.equal(ai.status(store.read(), {}).providers.some((p) => p.id === 'backup'), false);
  await assert.rejects(ai.configure({ store, order: [id, id] }), /duplicates/);
  await assert.rejects(ai.configure({ store, order: ['unknown'] }), /no longer saved/);
  await assert.rejects(ai.configure({ store: memoryStore(), mode: 'hosted' }), /Add and enable/);
});

test('saved endpoints reject private, insecure and credential-bearing URLs before any call', async () => {
  const store = memoryStore();
  const invalid = [
    'http://api.example.com/v1', 'https://localhost/v1', 'https://localhost./v1', 'https://127.0.0.1/v1',
    'https://2130706433/v1', 'https://0x7f000001/v1', 'https://10.1.2.3/v1', 'https://172.16.0.1/v1',
    'https://192.168.1.1/v1', 'https://169.254.169.254/latest/meta-data', 'https://100.64.0.1/v1',
    'https://[::1]/v1', 'https://[::ffff:127.0.0.1]/v1', 'https://[fc00::1]/v1', 'https://[fe80::1]/v1',
    'https://[2001:db8::1]/v1', 'https://[2002:7f00:1::]/v1', 'https://host.local/v1',
    'https://user:password@api.example.com/v1', 'https://api.example.com/v1?key=secret', 'https://api.example.com/v1#fragment'
  ];
  for (const baseUrl of invalid) {
    await assert.rejects(ai.save({ store, provider: 'custom', apiKey: 'secret', model: 'model', baseUrl }), /HTTPS|public internet/, baseUrl);
  }
  await assert.rejects(ai.save({ store, provider: 'custom', id: '__proto__', apiKey: 'secret', model: 'model', baseUrl: 'https://api.example.com' }), /supported/);
  await assert.rejects(ai.save({ store, provider: 'custom', protocol: 'unknown', apiKey: 'secret', model: 'model', baseUrl: 'https://api.example.com' }), /format/);
});

test('removing an environment-backed provider clears its saved key and disables the remaining environment key', async () => {
  const store = memoryStore({ auth: { aiMode: 'hosted', aiProviders: { openai: { apiKey: 'saved-secret', model: 'custom-model' } } } });
  const env = { OPENAI_API_KEY: 'environment-secret' };
  const result = await ai.remove({ store, provider: 'openai', env });
  const row = result.providers.find((p) => p.id === 'openai');
  assert.equal(row.configured, true);
  assert.equal(row.enabled, false);
  assert.equal(row.source, 'environment');
  assert.equal(row.model, 'custom-model');
  assert.equal(result.configured, false);
  assert.equal(store.read().auth.aiProviders.openai.apiKey, undefined);
  assert.deepEqual(ai.configurations(store.read(), env), []);
  assert.doesNotMatch(JSON.stringify(result), /saved-secret|environment-secret/);
});

test('auth, credits, rate limits, outage, network and unusable output advance to the next provider', async () => {
  const state = {};
  const primary = await startChat(state);
  const backup = await startChat();
  const site = { auth: { aiMode: 'hosted', aiOrder: ['first', 'second'], aiProviders: {
    first: { apiKey: 'first-secret', label: 'First', model: 'model-a', baseUrl: 'https://first.example.com/v1' },
    second: { apiKey: 'second-secret', label: 'Second', model: 'model-b', baseUrl: 'https://second.example.com/v1' }
  } } };
  const env = { FIRST_BASE_URL: primary.base, SECOND_BASE_URL: `${backup.base}/v1/chat/completions` };
  const cases = [
    { status: 401, response: { error: { message: 'first-secret' } } }, { status: 402 }, { status: 429 }, { status: 503 },
    { disconnect: true }, { raw: 'invalid HTTP response JSON' },
    { response: { choices: [{ finish_reason: 'length', message: { content: '{"text":"Cut short"}' } }] } },
    { response: { choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] } },
    { response: { choices: [{ finish_reason: 'stop', message: { content: '{"other":"missing text"}' } }] } },
    { response: { choices: [{ finish_reason: 'stop', message: { content: '{"text":"  "}' } }] } },
    { response: { choices: [{ finish_reason: 'stop', message: { content: '{"text":42}' } }] } }
  ];
  try {
    for (const failure of cases) {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, failure);
      const response = await ai.create({ site, env, request });
      assert.deepEqual(response.provider, { id: 'second', label: 'Second' });
      assert.equal(response.fallbackCount, 1);
      assert.equal(JSON.parse(response.content[0].text).text, 'Useful varied copy');
    }
    assert.equal(primary.calls.length, cases.length);
    assert.equal(backup.calls.length, cases.length);
    assert.ok(backup.calls.every((call) => call.path === '/v1/chat/completions'), 'a full pasted endpoint is not duplicated');
  } finally { await primary.stop(); await backup.stop(); }
});

test('native custom Anthropic endpoint extracts system messages and reports which provider succeeded', async () => {
  const custom = await startFakeAnthropic({ answer: { text: 'Different specific copy' } });
  try {
    const site = { auth: { aiMode: 'hosted', aiProviders: { native: { protocol: 'anthropic', apiKey: 'native-secret', model: 'native-model', label: 'Native', baseUrl: 'https://native.example.com' } } } };
    const result = await ai.create({ site, env: { NATIVE_BASE_URL: `${custom.base}/v1/messages` }, request: { ...request, system: 'Existing system', messages: [{ role: 'system', content: 'Respect the requested tone.' }, ...request.messages] } });
    assert.equal(custom.calls[0].path, '/v1/messages');
    assert.equal(custom.calls[0].body.system, 'Existing system\n\nRespect the requested tone.');
    assert.deepEqual(custom.calls[0].body.messages.map((message) => message.role), ['user']);
    assert.equal(custom.calls[0].key, 'native-secret');
    assert.deepEqual(result.provider, { id: 'native', label: 'Native' });
    assert.equal(result.fallbackCount, 0);
  } finally { await custom.stop(); }
});

test('provider refusals stop without sending the content to backups', async () => {
  const state = {};
  const primary = await startChat(state);
  const backup = await startChat();
  const site = { auth: { aiMode: 'hosted', aiProviders: { openai: { apiKey: 'primary' }, gemini: { apiKey: 'backup' } } } };
  try {
    const cases = [
      { response: { choices: [{ finish_reason: 'stop', message: { refusal: 'Declined' } }] } },
      { response: { choices: [{ finish_reason: 'content_filter', message: {} }] } },
      { status: 400, response: { error: { code: 'content_policy_violation', message: 'Declined' } } },
      { status: 200, response: { promptFeedback: { blockReason: 'SAFETY' } } },
      { status: 200, response: { promptFeedback: { blockReason: 'BLOCKLIST' } } }
    ];
    for (const failure of cases) {
      Object.assign(state, failure);
      const result = await ai.create({ site, env: { OPENAI_BASE_URL: primary.base, GEMINI_BASE_URL: backup.base }, request });
      assert.equal(result.stop_reason, 'refusal');
      assert.equal(result.fallbackCount, 0);
    }
    assert.equal(backup.calls.length, 0);
  } finally { await primary.stop(); await backup.stop(); }
});

test('redirects are never followed and cannot receive a forwarded API key', async () => {
  const destination = await startChat();
  const redirect = await startChat({ status: 307, headers: { Location: `${destination.base}/private` } });
  try {
    const site = { auth: { aiMode: 'hosted', aiProviders: { openai: { apiKey: 'secret' } } } };
    await assert.rejects(ai.create({ site, env: { OPENAI_BASE_URL: redirect.base }, request }), /unavailable/);
    assert.equal(redirect.calls.length, 1);
    assert.equal(destination.calls.length, 0);
  } finally { await redirect.stop(); await destination.stop(); }
});

test('public hostnames resolving to private or mixed addresses never open a socket', async (t) => {
  let sockets = 0;
  t.mock.method(https, 'request', () => { sockets += 1; throw new Error('unexpected socket'); });
  const site = { auth: { aiMode: 'hosted', aiProviders: { custom: { apiKey: 'secret', model: 'model', baseUrl: 'https://api.example.com/v1' } } } };
  for (const addresses of [
    [{ address: '127.0.0.1', family: 4 }], [{ address: '169.254.169.254', family: 4 }],
    [{ address: '8.8.8.8', family: 4 }, { address: '10.1.2.3', family: 4 }], [{ address: '::ffff:127.0.0.1', family: 6 }]
  ]) {
    const lookup = t.mock.method(dns.promises, 'lookup', async () => addresses);
    await assert.rejects(ai.create({ site, env: {}, request }), /unavailable/);
    lookup.mock.restore();
  }
  assert.equal(sockets, 0);
});

test('connections pin validated DNS answers while preserving the TLS hostname', async (t) => {
  let lookups = 0;
  t.mock.method(dns.promises, 'lookup', async () => {
    lookups += 1;
    return [{ address: lookups === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }];
  });
  t.mock.method(https, 'request', (url, options, onResponse) => {
    assert.equal(url.hostname, 'api.example.com');
    assert.equal(options.agent, false);
    options.lookup('api.example.com', {}, (error, address, family) => {
      assert.equal(error, null); assert.equal(address, '8.8.8.8'); assert.equal(family, 4);
    });
    options.lookup('api.example.com', { all: true }, (error, addresses) => {
      assert.equal(error, null); assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]);
    });
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter(); res.statusCode = 200; onResponse(res);
      res.emit('data', Buffer.from(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"text":"Safe result"}' } }] })));
      res.emit('end'); req.emit('close');
    });
    req.destroy = (err) => { req.emit('error', err); req.emit('close'); };
    return req;
  });
  const site = { auth: { aiMode: 'hosted', aiProviders: { custom: { apiKey: 'secret', model: 'model', baseUrl: 'https://api.example.com/v1' } } } };
  const result = await ai.create({ site, env: {}, request });
  assert.equal(JSON.parse(result.content[0].text).text, 'Safe result');
  assert.equal(lookups, 1, 'socket does not repeat DNS lookup after validation');
});

test('a timed-out endpoint advances to the backup and closes its connection', async (t) => {
  const realSetTimeout = global.setTimeout;
  t.mock.method(global, 'setTimeout', (fn, ms, ...args) => realSetTimeout(fn, ms >= 10000 ? 30 : ms, ...args));
  const primary = await startChat({ stall: true });
  const backup = await startChat();
  try {
    const site = { auth: { aiMode: 'hosted', aiProviders: { openai: { apiKey: 'primary' }, gemini: { apiKey: 'backup' } } } };
    const result = await ai.create({ site, env: { OPENAI_BASE_URL: primary.base, GEMINI_BASE_URL: backup.base }, request });
    assert.equal(result.provider.id, 'gemini');
    assert.equal(result.fallbackCount, 1);
    assert.equal(primary.calls.length, 1);
    assert.equal(backup.calls.length, 1);
  } finally { await primary.stop(); await backup.stop(); }
});
