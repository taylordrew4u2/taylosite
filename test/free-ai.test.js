'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../public/assets/js/free-ai.js'), 'utf8');
const modulePromise = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const schema = { type: 'object', required: ['text'], properties: { text: { type: 'string' } } };
const options = { schema, messages: [{ role: 'user', content: 'Rewrite factual copy.' }] };
function fakeEngine(create, dispose = () => {}) { return { engine: { chat: { completions: { create } } }, dispose }; }
const answer = (content = '{"text":"Taylor Drew is a stand-up comedian in New York City."}') => ({ choices: [{ finish_reason: 'stop', message: { content } }] });

test('free generator reuses its model and switches to vision without a hosted call', async () => {
  const { createGenerator } = await modulePromise;
  const loaded = [], requests = []; let disposed = 0;
  const generate = createGenerator(async vision => { loaded.push(vision); return fakeEngine(async request => { requests.push(request); return answer(); }, () => disposed++); });
  assert.match((await generate(options)).text, /Taylor Drew/);
  await generate(options);
  await generate({ ...options, vision: true });
  assert.deepEqual(loaded, [false, true]);
  assert.equal(disposed, 1);
  assert.equal(requests[0].response_format.schema, JSON.stringify(schema));
});

test('invalid, empty and truncated results fail rather than overwrite a field', async () => {
  const { createGenerator } = await modulePromise;
  for (const response of [answer('not json'), answer('{"text":""}'), answer('{"text":1}'), answer('{}'), { choices: [{ finish_reason: 'length', message: { content: '{"text":"partial"}' } }] }]) {
    let disposed = false;
    const generate = createGenerator(async () => fakeEngine(async () => response, () => { disposed = true; }));
    await assert.rejects(generate(options), /Free AI:/);
    assert.equal(disposed, true);
  }
});

test('concurrent generation is refused and failed loading can be retried', async () => {
  const { createGenerator } = await modulePromise;
  let release;
  const generate = createGenerator(async () => { await new Promise(resolve => { release = resolve; }); return fakeEngine(async () => answer()); });
  const first = generate(options);
  await assert.rejects(generate(options), /already working/);
  release(); await first;
  let attempts = 0;
  const retry = createGenerator(async () => { if (!attempts++) throw new Error('download failed'); return fakeEngine(async () => answer()); });
  await assert.rejects(retry(options), /download failed/);
  assert.ok((await retry(options)).text);
});


test('vision framing preserves every edge of square and portrait images', async () => {
  const { imagePlacement } = await modulePromise;
  assert.deepEqual(imagePlacement(256, 256), { width: 768, height: 768, x: 128, y: 0 });
  assert.deepEqual(imagePlacement(600, 1200), { width: 384, height: 768, x: 320, y: 0 });
  assert.deepEqual(imagePlacement(1600, 600), { width: 1024, height: 384, x: 0, y: 192 });
});
