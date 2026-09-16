// Open-source models run on this device. No hosted inference or API credentials.
// Strongest first, newest generation preferred at every size. A 1.5B model
// writes unusable SEO/GEO copy, so the best model this device can actually hold
// is loaded, and the list is walked downwards only when a model is missing from
// the WebLLM build or fails to load. Every id below exists in WebLLM 0.2.85 and
// is checked against the runtime catalog before use.
const TEXT_MODELS = [
  'Qwen3.5-9B-q4f16_1-MLC',
  'Qwen3-8B-q4f16_1-MLC',
  'Llama-3.1-8B-Instruct-q4f16_1-MLC',
  'Hermes-3-Llama-3.1-8B-q4f16_1-MLC',
  'Qwen2.5-7B-Instruct-q4f16_1-MLC',
  'Qwen3.5-4B-q4f16_1-MLC',
  'Phi-4-mini-instruct-q4f16_1-MLC',
  'Qwen3-4B-q4f16_1-MLC',
  'Qwen2.5-3B-Instruct-q4f16_1-MLC',
  'Qwen3.5-2B-q4f16_1-MLC',
  'Llama-3.2-3B-Instruct-q4f16_1-MLC',
  'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'
];
const VISION_MODELS = ['Phi-3.5-vision-instruct-q4f16_1-MLC'];
const LAST_RESORT = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
const WEB_LLM = 'https://esm.run/@mlc-ai/web-llm@0.2.85';

// WebGPU never reports total VRAM. maxBufferSize tracks the device class closely
// enough to pick a starting tier, and a failed load falls through to the next
// model anyway, so an optimistic estimate costs a retry rather than a dead end.
// navigator.deviceMemory is only used to hold back the large models on a
// genuinely small machine; Chrome caps it at 8, so it never limits a big one.
export function budgetFromLimits(limits, deviceMemoryGB) {
  const largest = Math.max(limits?.maxBufferSize || 0, limits?.maxStorageBufferBindingSize || 0) / (1024 * 1024);
  const budget = largest ? Math.min(16384, Math.max(2048, Math.round(largest * 4))) : 2048;
  if (deviceMemoryGB && deviceMemoryGB <= 4) return Math.min(budget, deviceMemoryGB <= 2 ? 2048 : 3000);
  return budget;
}

// What the machine reports and what is pleasant to use on it are different
// questions. A laptop can hold an 8B model and will still spend ten minutes
// downloading it and generate at a crawl, so the default stays in laptop
// territory and the largest models are an explicit choice.
export const SIZES = { fast: 2600, balanced: 4200, best: Infinity };
export const DEFAULT_SIZE = 'balanced';

export function budgetFor(limits, deviceMemoryGB, size) {
  const ceiling = Object.hasOwn(SIZES, size) ? SIZES[size] : SIZES[DEFAULT_SIZE];
  return Math.min(budgetFromLimits(limits, deviceMemoryGB), ceiling);
}

export function chooseModels(available, { vision = false, supportsF16 = true, budgetMB = 2048, storageMB = Infinity } = {}) {
  const entries = new Map((available || []).map((entry) => [entry.model_id, entry]));
  const variant = (id) => (supportsF16 ? id : id.replace('q4f16', 'q4f32'));
  const wanted = vision ? VISION_MODELS : TEXT_MODELS;
  const vram = (id) => entries.get(id)?.vram_required_MB || 0;
  // Weights are cached on disk. A model the browser will not let this origin
  // store is not a fallback, it is a download that dies near the end.
  const storable = (id) => vram(id) <= storageMB;
  const chosen = [];
  const add = (id) => { if (entries.has(id) && storable(id) && !chosen.includes(id)) chosen.push(id); };
  for (const id of wanted) if (vision || vram(variant(id)) <= budgetMB) add(variant(id));
  // The VRAM budget is an estimate, so a slightly larger model is still worth
  // an attempt — nearest first, and never far enough above to waste a download
  // this device could never hold.
  if (!vision) {
    wanted.map(variant).filter((id) => entries.has(id) && !chosen.includes(id) && vram(id) <= budgetMB * 1.5)
      .sort((a, b) => vram(a) - vram(b)).forEach(add);
    add(variant(LAST_RESORT));
  }
  if (chosen.length) return chosen;
  return storable(variant(wanted[0])) ? [variant(wanted[0])] : [];
}

// Safari caps what one site may store and evicts it after a week of disuse, so
// ask for persistence and find out how much room there really is before
// starting a multi-gigabyte download.
export async function freeStorageMB(storage = globalThis.navigator?.storage) {
  try {
    if (!storage?.estimate) return Infinity;
    if (storage.persist) await storage.persist();
    const { quota = 0, usage = 0 } = (await storage.estimate()) || {};
    if (!quota) return Infinity;
    return Math.max(0, (quota - usage) / (1024 * 1024));
  } catch (_) { return Infinity; }
}

function describe(id, available) {
  const size = (available || []).find((entry) => entry.model_id === id)?.vram_required_MB;
  return size ? `${id} (~${Math.round(size / 1024 * 10) / 10} GB)` : id;
}

async function browserEngine(vision, onProgress, signal, size) {
  if (!globalThis.navigator?.gpu) throw new Error('Free AI needs WebGPU: Safari 18 or later, or Chrome, on macOS. Or edit this field manually — your content is unchanged.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No compatible GPU is available. Try Chrome on a computer, or edit manually.');
  const webllm = await import(WEB_LLM);
  if (signal.aborted) throw new Error('Loading timed out.');
  const available = webllm.prebuiltAppConfig?.model_list || [];
  const storageMB = await freeStorageMB();
  const models = chooseModels(available, {
    vision, supportsF16: adapter.features.has('shader-f16'), storageMB,
    budgetMB: budgetFor(adapter.limits, navigator.deviceMemory, size)
  });
  if (!models.length) {
    throw new Error(`This browser will only let the site store about ${Math.round(storageMB)} MB, and the smallest free model needs roughly 1.6 GB. Keep the panel open and allow storage when asked, free up disk space, or use your own API provider.`);
  }
  let lastError;
  for (const model of models) {
    if (signal.aborted) throw new Error('Loading timed out.');
    const worker = new Worker('/assets/js/free-ai-worker.js', { type: 'module' });
    const dispose = () => { worker.terminate(); signal.removeEventListener('abort', dispose); };
    signal.addEventListener('abort', dispose, { once: true });
    try {
      onProgress(`Loading ${describe(model, available)}…`);
      const engine = await webllm.CreateWebWorkerMLCEngine(worker, model, {
        initProgressCallback: (report) => onProgress(report.text || `Loading ${model}…`)
      });
      return { engine, dispose, model };
    } catch (error) {
      dispose();
      lastError = error;
      if (signal.aborted) throw error;
      onProgress('That model did not fit on this device. Trying a smaller one…');
    }
  }
  throw lastError || new Error('No free model could be loaded on this device.');
}

// Phi's compiled image prefill fits a 4:3 frame. Letterbox, never crop.
export function imagePlacement(width, height) {
  const scale = Math.min(1024 / width, 768 / height);
  return { width: width * scale, height: height * scale,
    x: (1024 - width * scale) / 2, y: (768 - height * scale) / 2 };
}

async function visionMessages(messages) {
  return Promise.all(messages.map(async (message) => {
    if (!Array.isArray(message.content)) return message;
    const content = await Promise.all(message.content.map(async (part) => {
      if (part.type !== 'image_url') return part;
      const response = await fetch(part.image_url.url);
      if (!response.ok) throw new Error('Could not load the image.');
      const bitmap = await createImageBitmap(await response.blob());
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1024; canvas.height = 768;
        const context = canvas.getContext('2d');
        const box = imagePlacement(bitmap.width, bitmap.height);
        context.fillStyle = 'white'; context.fillRect(0, 0, 1024, 768);
        context.drawImage(bitmap, box.x, box.y, box.width, box.height);
        return { type: 'image_url', image_url: { url: canvas.toDataURL('image/png') } };
      } finally { bitmap.close(); }
    }));
    return { ...message, content };
  }));
}

export function createGenerator(loadEngine = browserEngine) {
  let current;
  let currentVision;
  let currentSize;
  let busy = false;
  return async function ({ messages, schema, vision = false, onProgress = () => {}, temperature = 0.2, maxTokens, size = DEFAULT_SIZE, onModel }) {
    if (busy) throw new Error('Free AI is already working. Wait for the current request to finish.');
    busy = true;
    const controller = new AbortController();
    let timer;
    let expired = false;
    const operation = async () => {
      if (!current || currentVision !== vision || (!vision && currentSize !== size)) {
        current?.dispose();
        current = null;
        onProgress(vision ? 'Loading free image AI (large first-use download)…' : 'Loading free writing AI (first-use download)…');
        const loaded = await loadEngine(vision, onProgress, controller.signal, size);
        if (expired) { loaded.dispose(); throw new Error('Loading timed out.'); }
        current = loaded;
        currentVision = vision;
        currentSize = size;
      }
      if (current.model && onModel) onModel(current.model);
      onProgress('Generating on your device…');
      const response = await current.engine.chat.completions.create({
        messages,
        temperature: temperature,
        max_tokens: maxTokens || (vision ? 512 : 1800),
        response_format: { type: 'json_object', schema: JSON.stringify(schema) },
        // Qwen3 and Qwen3.5 open with a reasoning block that the JSON grammar
        // cannot hold. Turn it off rather than have the model fight the schema.
        extra_body: { enable_thinking: false }
      });
      const choice = response.choices?.[0];
      if (choice?.finish_reason === 'length') throw new Error('The result was cut short. Try a shorter field.');
      const result = JSON.parse(choice?.message?.content || 'null');
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('The model did not return a usable result.');
      for (const key of schema.required || []) {
        if (!(key in result)) throw new Error('The model returned an incomplete result.');
      }
      if (schema.properties?.text && (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 6000)) {
        throw new Error('The model did not return usable text.');
      }
      return result;
    };
    try {
      return await Promise.race([operation(), new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; controller.abort(); current?.dispose(); current = null; reject(new Error('Free AI took too long. Your content is unchanged. Try again or edit manually.')); }, 600000);
      })]);
    } catch (error) {
      current?.dispose();
      current = null;
      const detail = error?.message || (typeof error === 'string' ? error : 'Could not generate a result. Your content is unchanged.');
      if (/NetworkError|Failed to fetch|Cache.add/i.test(detail)) {
        throw new Error('The free model download was interrupted. Check your connection and try again; downloaded files are cached. Your content is unchanged.');
      }
      throw new Error('Free AI: ' + detail);
    } finally { clearTimeout(timer); busy = false; }
  };
}

const run = createGenerator();
export async function generate(options) {
  return run({ ...options, messages: options.vision ? await visionMessages(options.messages) : options.messages });
}
