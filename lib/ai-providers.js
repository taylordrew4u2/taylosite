'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const PROVIDERS = {
  anthropic: { label: 'Anthropic', model: 'claude-opus-5' },
  openai: { label: 'OpenAI', model: 'gpt-4.1-mini', url: 'https://api.openai.com/v1' },
  gemini: { label: 'Google Gemini', model: 'gemini-2.5-flash', url: 'https://generativelanguage.googleapis.com/v1beta/openai' }
};
const hasProvider = (id) => Object.hasOwn(PROVIDERS, id);

function configurations(site, env = process.env) {
  const auth = site?.auth || {};
  return Object.entries(PROVIDERS).map(([id, spec]) => {
    const saved = { ...(id === 'anthropic' ? auth.anthropic : {}), ...auth.aiProviders?.[id] };
    return { id, ...spec, key: saved.apiKey || env[`${id.toUpperCase()}_API_KEY`] || '',
      model: saved.model || env[`${id.toUpperCase()}_MODEL`] || spec.model,
      source: saved.apiKey ? 'panel' : 'environment' };
  }).filter((p) => p.key).sort((a, b) => Number(b.id === auth.aiPrimary) - Number(a.id === auth.aiPrimary));
}

function status(site, env = process.env) {
  const configured = configurations(site, env);
  return { configured: configured.length > 0, model: configured[0]?.model || '', source: configured[0]?.source || null,
    primary: configured[0]?.id || '', providers: Object.entries(PROVIDERS).map(([id, spec]) => {
      const p = configured.find((entry) => entry.id === id);
      return { id, label: spec.label, configured: Boolean(p), model: p?.model || spec.model, source: p?.source || null };
    }) };
}

async function save({ store, provider, apiKey, model, primary }) {
  if (!hasProvider(provider)) throw new Error('Choose a supported AI provider.');
  const key = String(apiKey || '').trim();
  const modelId = String(model || '').trim();
  if (key && (key.length < 20 || key.length > 500 || /\s/.test(key))) throw new Error('Enter a valid API key.');
  if (modelId.length > 120 || (modelId && !/^[\w.:/-]+$/.test(modelId))) throw new Error('Enter a valid model ID.');
  await store.update((site) => {
    site.auth ||= {};
    site.auth.aiProviders ||= {};
    const existing = configurations(site).find((p) => p.id === provider);
    if (!key && !existing) throw new Error('Enter an API key for this provider.');
    site.auth.aiProviders[provider] = { ...(site.auth.aiProviders[provider] || {}),
      ...(key ? { apiKey: key } : {}), model: modelId || existing?.model || PROVIDERS[provider].model };
    if (primary) site.auth.aiPrimary = provider;
    return site;
  });
}

async function remove({ store, provider }) {
  if (!hasProvider(provider)) throw new Error('Choose a supported AI provider.');
  await store.update((site) => {
    if (site.auth?.aiProviders) delete site.auth.aiProviders[provider];
    if (provider === 'anthropic' && site.auth) delete site.auth.anthropic;
    if (site.auth?.aiPrimary === provider) delete site.auth.aiPrimary;
    return site;
  });
}

// Keep the existing Messages response shape for copy, photos and flyer readers.
async function create({ site, env = process.env, request }) {
  if (env.AI_HOSTED_ENABLED !== 'true') throw Object.assign(new Error('Hosted AI is disabled. Use the free browser generator; no API key is required.'), { status: 400 });
  const providers = configurations(site, env);
  if (!providers.length) throw Object.assign(new Error('Add an AI API key under Security → AI providers.'), { status: 400 });
  const failed = [];
  let lastError;
  for (const p of providers) {
    try {
      if (p.id === 'anthropic') {
        const client = new Anthropic({ apiKey: p.key, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: 0, timeout: 15000 });
        return await client.messages.create({ ...request, model: p.model });
      }
      const messages = request.messages.map((message) => ({ ...message,
        content: typeof message.content === 'string' ? message.content : message.content.map((block) => block.type === 'image'
          ? { type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } } : block)
      }));
      messages.unshift({ role: 'system', content: `Return JSON matching this schema: ${JSON.stringify(request.output_config.format.schema)}` });
      const response = await fetch(`${env[`${p.id.toUpperCase()}_BASE_URL`] || p.url}/chat/completions`, {
        method: 'POST', headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: p.model, messages, max_completion_tokens: request.max_tokens, response_format: { type: 'json_object' } }),
        signal: AbortSignal.timeout(15000), redirect: 'error'
      });
      if (!response.ok) throw Object.assign(new Error('Provider request failed'), { status: response.status });
      const data = await response.json();
      const choice = data.choices?.[0];
      if (choice?.message?.refusal) return { stop_reason: 'refusal', content: [] };
      if (!choice?.message?.content || choice.finish_reason === 'length') throw new Error('Incomplete response');
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: choice.message.content }] };
    } catch (err) {
      lastError = err;
      // Never expose provider response bodies or credentials to the browser.
      failed.push(p.label);
    }
  }
  if (providers.length === 1 && [401, 403].includes(lastError?.status)) throw Object.assign(new Error('The provider rejected the API key. Check Security → AI providers.'), { status: 400 });
  if (providers.length === 1 && lastError?.status === 429) throw Object.assign(new Error('The provider is rate-limiting this key or has no credits. Add a backup in Security → AI providers.'), { status: 429 });
  throw Object.assign(new Error(`AI providers unavailable (${failed.join(', ')}). Check credits, keys and model IDs in Security → AI providers, or add another provider.`), { status: 502 });
}

module.exports = { status, save, remove, create, configurations };
