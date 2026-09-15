'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const MAX_TEXT = 6000;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: { text: { type: 'string' } }
};

function apiKey(env, site) {
  const saved = site && site.auth && site.auth.anthropic;
  return String((saved && saved.apiKey) || env.ANTHROPIC_API_KEY || '').trim();
}

function factualContext(site) {
  const credits = (((site || {}).about || {}).credits || [])
    .filter((credit) => credit && credit.visible !== false && credit.title)
    .map((credit) => [credit.title, credit.detail, credit.year].filter(Boolean).join(' — '));
  return {
    name: site.brand && site.brand.name,
    role: site.brand && site.brand.accentLabel,
    location: site.brand && site.brand.location,
    biography: (((site || {}).about || {}).body || []).filter(Boolean),
    credits
  };
}

function instruction({ text, path, label, site }) {
  return [
    'Rewrite one public-facing website field for search and AI discovery.',
    'The copy must sound like a human wrote it and remain useful to visitors.',
    'Preserve every fact in the original. Never invent an award, credit, date, venue, appearance, quote, relationship, or claim.',
    'Do not keyword-stuff. Do not add hashtags. Do not add HTML. Do not hide keywords.',
    'Use the exact entity name "Taylor Drew" and the phrase "New York City stand-up comedian" only when natural for this field.',
    'Keep a short label or title short. Keep a paragraph close to its original length unless clarity needs a little more room.',
    'Return only the rewritten field in the required JSON shape.',
    `Field label: ${label || 'Text'}`,
    `Field path: ${path || 'unknown'}`,
    `Current text: ${text}`,
    `Known facts: ${JSON.stringify(factualContext(site))}`
  ].join('\n');
}

async function rewrite({ text, path, label, site, env = process.env }) {
  const source = String(text == null ? '' : text).trim().slice(0, MAX_TEXT);
  if (!source) throw Object.assign(new Error('Write something first, then generate its SEO version.'), { status: 400 });
  const key = apiKey(env, site);
  if (!key) {
    throw Object.assign(new Error('SEO generation needs the Anthropic API key under Shows → Post a flyer.'), { status: 400 });
  }

  const client = new Anthropic({ apiKey: key, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: 1, timeout: 25000 });
  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: instruction({ text: source, path, label, site }) }]
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw Object.assign(new Error('Anthropic rejected the API key. Check it under Shows → Post a flyer.'), { status: 400 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw Object.assign(new Error('Anthropic is busy right now. Try again in a minute.'), { status: 429 });
    }
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      throw Object.assign(new Error('SEO generation took too long. Try again.'), { status: 504 });
    }
    throw Object.assign(new Error(`Could not generate SEO copy: ${err.message}`), { status: 502 });
  }

  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error('The model declined to rewrite that field.'), { status: 422 });
  }
  const raw = (response.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw Object.assign(new Error('The model did not return usable copy. Try again.'), { status: 502 });
  }
  const result = String((parsed && parsed.text) || '').trim().slice(0, MAX_TEXT);
  if (!result) throw Object.assign(new Error('The model returned an empty field. Your original was kept.'), { status: 502 });
  return result;
}

module.exports = { rewrite, instruction, factualContext, MODEL };
