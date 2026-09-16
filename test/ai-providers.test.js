'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const ai = require('../lib/ai-providers');
const { startFakeAnthropic } = require('./helpers/fake-anthropic');
const request = { max_tokens: 512, output_config: { format: { schema: { type: 'object', properties: { text: { type: 'string' } } } } }, messages: [{ role: 'user', content: 'Return JSON for SEO + GEO.' }] };

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
