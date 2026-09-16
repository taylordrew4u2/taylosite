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

test('the size choice caps the model tier and an unknown value falls back to balanced', async () => {
  const { budgetFor, SIZES, DEFAULT_SIZE } = await modulePromise;
  const roomy = { maxBufferSize: 4 * 1024 * 1024 * 1024 };
  assert.equal(DEFAULT_SIZE, 'balanced');
  assert.equal(budgetFor(roomy, undefined, 'fast'), SIZES.fast);
  assert.equal(budgetFor(roomy, undefined, 'balanced'), SIZES.balanced);
  assert.equal(budgetFor(roomy, undefined, 'best'), 16384);
  assert.equal(budgetFor(roomy, undefined, undefined), SIZES.balanced);
  assert.equal(budgetFor(roomy, undefined, 'enormous'), SIZES.balanced);
  // A small machine still wins over a large choice.
  assert.equal(budgetFor(roomy, 2, 'best'), 2048);
});

test('a laptop-sized budget lands on a 4B model, and Fast drops to a 3B', async () => {
  const { chooseModels, budgetFor } = await modulePromise;
  const laptop = { maxBufferSize: 1024 * 1024 * 1024 };
  assert.equal(chooseModels(catalog, { budgetMB: budgetFor(laptop, undefined, 'balanced') })[0], 'Qwen3.5-4B-q4f16_1-MLC');
  assert.equal(chooseModels(catalog, { budgetMB: budgetFor(laptop, undefined, 'fast') })[0], 'Qwen2.5-3B-Instruct-q4f16_1-MLC');
});

test('changing the size reloads the engine, and the model id is reported back', async () => {
  const { createGenerator } = await modulePromise;
  const sizes = []; const seen = [];
  const generate = createGenerator(async (vision, onProgress, signal, size) => {
    sizes.push(size);
    return { engine: { chat: { completions: { create: async () => answer() } } }, dispose: () => {}, model: 'Model-' + size };
  });
  await generate({ ...options, size: 'balanced', onModel: (model) => seen.push(model) });
  await generate({ ...options, size: 'balanced', onModel: (model) => seen.push(model) });
  await generate({ ...options, size: 'best', onModel: (model) => seen.push(model) });
  assert.deepEqual(sizes, ['balanced', 'best']);
  assert.deepEqual(seen, ['Model-balanced', 'Model-balanced', 'Model-best']);
});

test('a model the browser cannot store is never offered, however much VRAM there is', async () => {
  const { chooseModels } = await modulePromise;
  const cramped = chooseModels(catalog, { budgetMB: 8192, storageMB: 2500 });
  assert.equal(cramped[0], 'Qwen3.5-2B-q4f16_1-MLC');
  assert.ok(cramped.every((id) => id !== 'Qwen3.5-9B-q4f16_1-MLC'));
  assert.deepEqual(chooseModels(catalog, { budgetMB: 8192, storageMB: 400 }), [], 'nothing fits, so nothing is downloaded');
  assert.deepEqual(chooseModels([], { budgetMB: 8192, storageMB: 400 }), ['Qwen3.5-9B-q4f16_1-MLC'], 'an unknown catalog is not second-guessed');
});

test('storage is made persistent and the free space is reported in MB', async () => {
  const { freeStorageMB } = await modulePromise;
  let persisted = false;
  assert.equal(await freeStorageMB({
    persist: async () => { persisted = true; return true; },
    estimate: async () => ({ quota: 3 * 1024 * 1024 * 1024, usage: 1024 * 1024 * 1024 })
  }), 2048);
  assert.equal(persisted, true);
  assert.equal(await freeStorageMB(undefined), Infinity, 'an old browser is not blocked by a missing API');
  assert.equal(await freeStorageMB({ estimate: async () => ({ quota: 0 }) }), Infinity);
  assert.equal(await freeStorageMB({ estimate: async () => { throw new Error('denied'); } }), Infinity);
  assert.equal(await freeStorageMB({ estimate: async () => ({ quota: 1024 * 1024 * 1024, usage: 2 * 1024 * 1024 * 1024 }) }), 0);
});
