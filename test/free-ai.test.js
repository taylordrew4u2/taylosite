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

const catalog = [
  { model_id: 'Qwen3.5-9B-q4f16_1-MLC', vram_required_MB: 6433 },
  { model_id: 'Qwen3-8B-q4f16_1-MLC', vram_required_MB: 5696 },
  { model_id: 'Qwen3.5-4B-q4f16_1-MLC', vram_required_MB: 3868 },
  { model_id: 'Qwen3.5-4B-q4f32_1-MLC', vram_required_MB: 4680 },
  { model_id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC', vram_required_MB: 5106 },
  { model_id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', vram_required_MB: 2504 },
  { model_id: 'Qwen2.5-3B-Instruct-q4f32_1-MLC', vram_required_MB: 3495 },
  { model_id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', vram_required_MB: 2263 },
  { model_id: 'Qwen3.5-2B-q4f16_1-MLC', vram_required_MB: 2245 },
  { model_id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', vram_required_MB: 1629 },
  { model_id: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC', vram_required_MB: 1888 },
  { model_id: 'Phi-3.5-vision-instruct-q4f16_1-MLC', vram_required_MB: 3952 }
];

test('a roomy GPU gets a capable writing model and a small one still gets a fallback chain', async () => {
  const { chooseModels } = await modulePromise;
  const big = chooseModels(catalog, { budgetMB: 8192 });
  assert.equal(big[0], 'Qwen3.5-9B-q4f16_1-MLC');
  assert.equal(big[1], 'Qwen3-8B-q4f16_1-MLC');
  assert.equal(big[big.length - 1], 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC');
  const roomy = chooseModels(catalog, { budgetMB: 4096 });
  assert.equal(roomy[0], 'Qwen3.5-4B-q4f16_1-MLC');
  const mid = chooseModels(catalog, { budgetMB: 2600 });
  assert.equal(mid[0], 'Qwen2.5-3B-Instruct-q4f16_1-MLC');
  const small = chooseModels(catalog, { budgetMB: 2048 });
  assert.equal(small[0], 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC');
  assert.ok(!small.includes('Qwen3.5-9B-q4f16_1-MLC'), 'a model this device could never hold is not downloaded');
  assert.equal(small[1], 'Qwen3.5-2B-q4f16_1-MLC', 'the next attempt is the nearest larger model, not the biggest');
  assert.equal(new Set(small).size, small.length);
});

test('a GPU without shader-f16 gets f32 builds, and vision keeps its own model', async () => {
  const { chooseModels } = await modulePromise;
  const models = chooseModels(catalog, { budgetMB: 8192, supportsF16: false });
  assert.ok(models.every((id) => id.includes('q4f32')), models.join(', '));
  assert.equal(models[0], 'Qwen3.5-4B-q4f32_1-MLC');
  assert.deepEqual(chooseModels(catalog, { vision: true, budgetMB: 1024 }), ['Phi-3.5-vision-instruct-q4f16_1-MLC']);
  assert.deepEqual(chooseModels([], { vision: true }), ['Phi-3.5-vision-instruct-q4f16_1-MLC']);
});

test('the VRAM budget is derived from WebGPU limits and stays within sane bounds', async () => {
  const { budgetFromLimits } = await modulePromise;
  assert.equal(budgetFromLimits(undefined), 2048);
  assert.equal(budgetFromLimits({ maxBufferSize: 128 * 1024 * 1024 }), 2048);
  assert.equal(budgetFromLimits({ maxBufferSize: 2 * 1024 * 1024 * 1024 }), 8192);
  assert.equal(budgetFromLimits({ maxStorageBufferBindingSize: 8 * 1024 * 1024 * 1024 }), 16384);
  // A small machine is held back, and Chrome's 8 GB ceiling never holds a big one back.
  assert.equal(budgetFromLimits({ maxBufferSize: 2 * 1024 * 1024 * 1024 }, 4), 3000);
  assert.equal(budgetFromLimits({ maxBufferSize: 2 * 1024 * 1024 * 1024 }, 2), 2048);
  assert.equal(budgetFromLimits({ maxBufferSize: 2 * 1024 * 1024 * 1024 }, 8), 8192);
});
