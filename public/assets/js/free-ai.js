// Open-source models run on this device. No hosted inference or API credentials.
const TEXT_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
const VISION_MODEL = 'Phi-3.5-vision-instruct-q4f16_1-MLC';

async function browserEngine(vision, onProgress, signal) {
  if (!globalThis.navigator?.gpu) throw new Error('Free AI needs a browser with WebGPU. Try current Chrome on a computer, or edit this field manually. Your content is unchanged.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No compatible GPU is available. Try Chrome on a computer, or edit manually.');
  let model = vision ? VISION_MODEL : TEXT_MODEL;
  if (!adapter.features.has('shader-f16')) model = model.replace('q4f16', 'q4f32');
  const webllm = await import('https://esm.run/@mlc-ai/web-llm@0.2.85');
  if (signal.aborted) throw new Error('Loading timed out.');
  const worker = new Worker('/assets/js/free-ai-worker.js', { type: 'module' });
  const dispose = () => { worker.terminate(); signal.removeEventListener('abort', dispose); };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    const engine = await webllm.CreateWebWorkerMLCEngine(worker, model, {
      initProgressCallback: (report) => onProgress(report.text || 'Loading free AI…')
    });
    return { engine, dispose };
  } catch (error) { dispose(); throw error; }
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
  let busy = false;
  return async function ({ messages, schema, vision = false, onProgress = () => {}, temperature = 0.2, maxTokens }) {
    if (busy) throw new Error('Free AI is already working. Wait for the current request to finish.');
    busy = true;
    const controller = new AbortController();
    let timer;
    let expired = false;
    const operation = async () => {
      if (!current || currentVision !== vision) {
        current?.dispose();
        current = null;
        onProgress(vision ? 'Loading free image AI (large first-use download)…' : 'Loading free writing AI (first-use download)…');
        const loaded = await loadEngine(vision, onProgress, controller.signal);
        if (expired) { loaded.dispose(); throw new Error('Loading timed out.'); }
        current = loaded;
        currentVision = vision;
      }
      onProgress('Generating on your device…');
      const response = await current.engine.chat.completions.create({
        messages,
        temperature: temperature,
        max_tokens: maxTokens || (vision ? 512 : 1800),
        response_format: { type: 'json_object', schema: JSON.stringify(schema) }
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
