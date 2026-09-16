'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const PROVIDERS = {
  anthropic: { label: 'Anthropic', model: 'claude-opus-5', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  openai: { label: 'OpenAI', model: 'gpt-4.1-mini', protocol: 'openai', baseUrl: 'https://api.openai.com/v1' },
  gemini: { label: 'Google Gemini', model: 'gemini-2.5-flash', protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' }
};
const TOTAL_TIMEOUT = 45000;
const PROVIDER_TIMEOUT = 15000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const hasProvider = (id) => Object.hasOwn(PROVIDERS, id);
const validId = (id) => typeof id === 'string' && /^[a-z][a-z0-9_-]{0,79}$/.test(id) && !['constructor', 'prototype', '__proto__'].includes(id);
const envPrefix = (id) => id.toUpperCase().replace(/-/g, '_');
const problem = (message, status = 400) => Object.assign(new Error(message), { status });

function mode(site, env) {
  if (['browser', 'hosted'].includes(site?.auth?.aiMode)) return site.auth.aiMode;
  return env.AI_HOSTED_ENABLED === 'true' ? 'hosted' : 'browser';
}

function records(site, env = process.env) {
  const auth = site?.auth || {};
  const savedProviders = auth.aiProviders || {};
  const ids = [...Object.keys(PROVIDERS), ...Object.keys(savedProviders).filter((id) => validId(id) && !hasProvider(id))];
  const ordered = Array.isArray(auth.aiOrder) ? auth.aiOrder.filter(validId) : [auth.aiPrimary].filter(validId);
  return ids.map((id) => {
    const spec = hasProvider(id) ? PROVIDERS[id] : {};
    const saved = { ...(id === 'anthropic' ? auth.anthropic : {}), ...(Object.hasOwn(savedProviders, id) ? savedProviders[id] : {}) };
    const key = saved.apiKey || env[`${envPrefix(id)}_API_KEY`] || '';
    return {
      id, label: saved.label || spec.label || id, protocol: saved.protocol || spec.protocol || 'openai',
      baseUrl: saved.baseUrl || spec.baseUrl || '', key,
      model: saved.model || env[`${envPrefix(id)}_MODEL`] || spec.model || '',
      enabled: saved.enabled !== false, configured: Boolean(key), source: key ? (saved.apiKey ? 'panel' : 'environment') : null
    };
  }).sort((a, b) => {
    const index = (p) => ordered.includes(p.id) ? ordered.indexOf(p.id) : ordered.length + ids.indexOf(p.id);
    return index(a) - index(b);
  });
}

function configurations(site, env = process.env) {
  return records(site, env).filter((provider) => provider.configured && provider.enabled);
}

function status(site, env = process.env) {
  const all = records(site, env);
  const first = all.find((p) => p.configured && p.enabled);
  return {
    mode: mode(site, env), configured: Boolean(first), model: first?.model || '', source: first?.source || null,
    primary: first?.id || '', providers: all.map(({ key, ...provider }) => provider)
  };
}

// Refuse special-purpose ranges as well as private networks. IPv4-mapped IPv6
// is rejected entirely, so an alternate spelling cannot bypass this check.
function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (net.isIP(address) === 6) {
    const lower = new URL(`https://[${address}]/`).hostname.slice(1, -1);
    const [first, second] = lower.split(':');
    return /^[23][0-9a-f]{3}:/.test(lower) && !(first === '2001' && (parseInt(second || '0', 16) <= 0x1ff || second === 'db8')) && first !== '2002' && first !== '3fff';
  }
  return false;
}

function loopback(address) {
  return address === 'localhost' || address === '::1' || (net.isIP(address) === 4 && address.startsWith('127.'));
}

function validateUrl(value, allowTestLoopback = false) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) { throw problem('Enter a valid HTTPS API base URL.'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  const testLoopback = allowTestLoopback && loopback(hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(testLoopback && url.protocol === 'http:'))) {
    throw problem('Use an HTTPS API base URL without credentials, query parameters or a fragment.');
  }
  if (!testLoopback && (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal') ||
    (!hostname.includes('.') && !net.isIP(hostname)) || (net.isIP(hostname) && !publicAddress(hostname)))) {
    throw problem('The API endpoint must use a public internet address.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

async function save({ store, provider, id, label, apiKey, model, baseUrl, protocol, primary, enabled }) {
  const custom = provider === 'custom';
  const providerId = id || (custom ? `custom-${crypto.randomUUID()}` : provider);
  if (!validId(providerId) || (custom && hasProvider(providerId))) throw problem('Choose a supported provider or add a custom API.');
  const key = String(apiKey || '').trim();
  if (key && (key.length > 4096 || /\s|[\x00-\x1f\x7f]/.test(key))) throw problem('Enter a valid API key.');
  const modelId = String(model || '').trim();
  if (modelId.length > 200 || (modelId && /\s|[\x00-\x1f\x7f]/.test(modelId))) throw problem('Enter a valid model ID.');
  if (protocol !== undefined && !['openai', 'anthropic'].includes(protocol)) throw problem('Choose OpenAI-compatible or Anthropic Messages format.');
  if (label !== undefined && (!String(label).trim() || String(label).trim().length > 80 || /[\x00-\x1f\x7f]/.test(label))) throw problem('Enter a provider name of up to 80 characters.');
  if (enabled !== undefined && typeof enabled !== 'boolean') throw problem('Enabled must be true or false.');
  const checkedUrl = baseUrl === undefined || baseUrl === '' ? undefined : validateUrl(baseUrl);
  let updated;
  await store.update((site) => {
    site.auth ||= {};
    site.auth.aiProviders ||= {};
    const existing = records(site).find((p) => p.id === providerId);
    if (!existing && !custom) throw problem('Choose a supported provider or add a custom API.');
    if (!key && !existing?.configured) throw problem('Enter an API key for this provider.');
    const chosenModel = modelId || existing?.model;
    const chosenUrl = checkedUrl || existing?.baseUrl;
    if (!chosenModel) throw problem('Enter the model ID from your API provider.');
    if (!chosenUrl) throw problem('Enter the API base URL from your provider.');
    site.auth.aiProviders[providerId] = {
      ...(site.auth.aiProviders[providerId] || {}), ...(key ? { apiKey: key } : {}),
      label: label === undefined ? existing?.label || providerId : String(label).trim(),
      model: chosenModel, baseUrl: chosenUrl, protocol: protocol || existing?.protocol || 'openai',
      enabled: enabled === undefined ? existing?.enabled !== false : enabled
    };
    const order = records(site).map((p) => p.id);
    site.auth.aiOrder = primary ? [providerId, ...order.filter((entry) => entry !== providerId)] : order;
    if (primary) site.auth.aiPrimary = providerId;
    updated = site;
    return site;
  });
  return status(updated);
}

async function configure({ store, mode: nextMode, order }) {
  if (nextMode !== undefined && !['browser', 'hosted'].includes(nextMode)) throw problem('Choose free browser AI or your API providers.');
  if (order !== undefined && (!Array.isArray(order) || order.length > 100 || order.some((id) => !validId(id)) || new Set(order).size !== order.length)) {
    throw problem('Choose a valid provider order without duplicates.');
  }
  let updated;
  await store.update((site) => {
    const all = records(site);
    if (order?.some((id) => !all.some((p) => p.id === id))) throw problem('That provider is no longer saved. Refresh the page.');
    if (nextMode === 'hosted' && !all.some((p) => p.configured && p.enabled)) throw problem('Add and enable an API provider first.');
    site.auth ||= {};
    if (nextMode !== undefined) site.auth.aiMode = nextMode;
    if (order !== undefined) {
      site.auth.aiOrder = [...order, ...all.map((p) => p.id).filter((id) => !order.includes(id))];
      site.auth.aiPrimary = site.auth.aiOrder[0] || '';
    }
    updated = site;
    return site;
  });
  return status(updated);
}

async function remove({ store, provider, id, env = process.env }) {
  const providerId = id || provider;
  if (!validId(providerId)) throw problem('Choose a supported provider or saved custom API.');
  let updated;
  await store.update((site) => {
    if (!hasProvider(providerId) && !Object.hasOwn(site.auth?.aiProviders || {}, providerId)) throw problem('That provider is no longer saved.');
    const existing = records(site, env).find((p) => p.id === providerId);
    if (site.auth?.aiProviders) delete site.auth.aiProviders[providerId];
    if (providerId === 'anthropic' && site.auth) delete site.auth.anthropic;
    if (env[`${envPrefix(providerId)}_API_KEY`]) {
      site.auth ||= {};
      site.auth.aiProviders ||= {};
      const { key, configured, source, id: _id, ...settings } = existing;
      site.auth.aiProviders[providerId] = { ...settings, enabled: false };
    }
    if (site.auth?.aiPrimary === providerId) delete site.auth.aiPrimary;
    if (site.auth?.aiOrder) site.auth.aiOrder = site.auth.aiOrder.filter((entry) => entry !== providerId);
    updated = site;
    return site;
  });
  return status(updated, env);
}

function endpoint(provider, env) {
  const override = env[`${envPrefix(provider.id)}_BASE_URL`];
  const url = new URL(validateUrl(override || provider.baseUrl, Boolean(override)));
  const path = url.pathname.replace(/\/+$/, '');
  if (provider.protocol === 'anthropic') url.pathname = /\/v1\/messages$/.test(path) ? path : `${path}${path.endsWith('/v1') ? '' : '/v1'}/messages`;
  else url.pathname = /\/chat\/completions$/.test(path) ? path : `${path}/chat/completions`;
  return { url, allowTestLoopback: Boolean(override) && loopback(url.hostname.replace(/^\[|\]$/g, '')) };
}

// Resolve, validate every DNS answer, and pin the connection to that result.
// TLS still verifies the original hostname. A second lookup cannot redirect
// the socket into a private network, and redirect responses are never followed.
async function postJson({ url, allowTestLoopback, headers, body, timeout }) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const started = Date.now();
  let resolutionTimer;
  const addresses = await Promise.race([
    net.isIP(hostname) ? Promise.resolve([{ address: hostname, family: net.isIP(hostname) }]) : dns.promises.lookup(hostname, { all: true, verbatim: true }),
    new Promise((_, reject) => { resolutionTimer = setTimeout(() => reject(problem('Provider timed out.', 504)), timeout); })
  ]).finally(() => clearTimeout(resolutionTimer));
  if (!addresses.length || addresses.some(({ address }) => !(publicAddress(address) || (allowTestLoopback && loopback(address))))) throw problem('The API endpoint must resolve only to public internet addresses.');
  const remaining = timeout - (Date.now() - started);
  if (remaining <= 0) throw problem('Provider timed out.', 504);
  const chosen = addresses[0];
  return new Promise((resolve, reject) => {
    let timer;
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(url, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      agent: false,
      lookup: (_name, options, callback) => {
        if (options?.all) callback(null, [chosen]);
        else callback(null, chosen.address, chosen.family);
      }
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('error', reject);
      res.on('aborted', () => reject(problem('Provider connection was interrupted.', 502)));
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) req.destroy(problem('Provider response was too large.', 502));
        else chunks.push(chunk);
      });
      res.on('end', () => {
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch (_) { return reject(problem('Provider returned invalid JSON.', res.statusCode >= 400 ? res.statusCode : 502)); }
        const refusalCodes = ['content_filter', 'content_policy_violation', 'responsibleaipolicyviolation', 'safety_violation', 'moderation_blocked', 'prohibited_content'];
        const blockReason = data?.promptFeedback?.blockReason;
        if ((blockReason && blockReason !== 'BLOCK_REASON_UNSPECIFIED') || [data?.error?.code, data?.error?.type, data?.error?.innererror?.code].some((code) => refusalCodes.includes(String(code || '').toLowerCase()))) {
          return reject(Object.assign(problem('The provider declined this request.', 422), { refusal: true }));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(problem('Provider request failed.', res.statusCode));
        resolve(data);
      });
    });
    timer = setTimeout(() => req.destroy(problem('Provider timed out.', 504)), remaining);
    req.on('error', reject);
    req.on('close', () => clearTimeout(timer));
    req.end(body);
  });
}

function conforms(value, schema) {
  if (!schema || typeof schema !== 'object') return true;
  if (schema.enum && !schema.enum.includes(value)) return false;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && !types.includes(type) && !(type === 'number' && types.includes('integer') && Number.isInteger(value))) return false;
  if (type === 'object') {
    if (schema.required?.some((name) => !Object.hasOwn(value, name))) return false;
    return Object.entries(schema.properties || {}).every(([name, property]) => !Object.hasOwn(value, name) || conforms(value[name], property));
  }
  if (type === 'array') return value.every((item) => conforms(item, schema.items));
  return true;
}

function validateResult(result, schema) {
  if (result.stop_reason === 'refusal') return result;
  if (!['end_turn', 'stop_sequence'].includes(result.stop_reason)) throw problem('Provider returned an incomplete answer.', 502);
  let raw = (result.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('').trim();
  raw = raw.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { throw problem('Provider returned invalid JSON.', 502); }
  if (!parsed || typeof parsed !== 'object' || !conforms(parsed, schema) || (Object.hasOwn(parsed, 'text') && (typeof parsed.text !== 'string' || !parsed.text.trim()))) {
    throw problem('Provider returned an unusable answer.', 502);
  }
  return { ...result, content: [{ type: 'text', text: JSON.stringify(parsed) }] };
}

function textContent(content) {
  return typeof content === 'string' ? content : (content || []).filter((block) => block.type === 'text').map((block) => block.text).join('\n');
}

// Keep the existing Messages response shape for copy, photos and flyer readers.
async function create({ site, env = process.env, request }) {
  if (mode(site, env) !== 'hosted') throw problem('Hosted AI is disabled. Choose your API providers in AI providers to enable it.');
  const providers = configurations(site, env);
  if (!providers.length) throw problem('Add and enable an AI API key in AI providers.');
  const failed = [];
  let lastError;
  const deadline = Date.now() + TOTAL_TIMEOUT;
  for (const p of providers) {
    const timeout = Math.min(PROVIDER_TIMEOUT, deadline - Date.now());
    if (timeout <= 0) break;
    try {
      const schema = request.output_config?.format?.schema;
      const system = [textContent(request.system), ...request.messages.filter((message) => message.role === 'system').map((message) => textContent(message.content))].filter(Boolean).join('\n\n');
      const messages = request.messages.filter((message) => message.role !== 'system');
      let body;
      let headers;
      if (p.protocol === 'anthropic') {
        body = { ...request, model: p.model, messages, ...(system ? { system } : {}) };
        headers = { 'x-api-key': p.key, 'anthropic-version': '2023-06-01' };
      } else {
        const chatMessages = messages.map((message) => ({ ...message,
          content: typeof message.content === 'string' ? message.content : message.content.map((block) => block.type === 'image'
            ? { type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } } : block)
        }));
        chatMessages.unshift({ role: 'system', content: [system, schema ? `Return only JSON matching this schema: ${JSON.stringify(schema)}` : 'Return only valid JSON.'].filter(Boolean).join('\n\n') });
        body = { model: p.model, messages: chatMessages, max_tokens: request.max_tokens, response_format: { type: 'json_object' },
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }) };
        headers = { Authorization: `Bearer ${p.key}` };
      }
      const data = await postJson({ ...endpoint(p, env), headers, body: JSON.stringify(body), timeout });
      let response = data;
      if (p.protocol !== 'anthropic') {
        const choice = data.choices?.[0];
        const refused = choice?.message?.refusal || choice?.finish_reason === 'content_filter';
        response = { stop_reason: refused ? 'refusal' : choice?.finish_reason === 'stop' ? 'end_turn' : 'incomplete',
          content: refused ? [] : [{ type: 'text', text: choice?.message?.content || '' }] };
      }
      return { ...validateResult(response, schema), provider: { id: p.id, label: p.label }, fallbackCount: failed.length };
    } catch (err) {
      if (err.refusal) return { stop_reason: 'refusal', content: [], provider: { id: p.id, label: p.label }, fallbackCount: failed.length };
      lastError = err;
      failed.push(p.label);
    }
  }
  if (providers.length === 1 && [401, 403].includes(lastError?.status)) throw problem('The provider rejected the API key. Check AI providers.');
  if (providers.length === 1 && lastError?.status === 429) throw problem('The provider is rate-limiting this key or has no credits. Add a backup in AI providers.', 429);
  throw problem(`AI providers unavailable (${failed.join(', ')}). Check credits, keys, endpoint and model IDs in AI providers, or add another provider. Try again.`, 502);
}

module.exports = { status, save, configure, remove, create, configurations };
