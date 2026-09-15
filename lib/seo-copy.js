'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const MAX_TEXT = 6000;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

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

function instruction({ text, path, label, site, mode = 'seo' }) {
  const geo = mode === 'geo';
  return [
    geo
      ? 'Rewrite one public-facing website field for generative engine optimization (GEO).'
      : 'Rewrite one public-facing website field for traditional search engine optimization (SEO).',
    'The copy must sound like a human wrote it and remain useful to visitors.',
    'Preserve every fact in the original. Never invent an award, credit, date, venue, appearance, quote, relationship, or claim.',
    'Do not keyword-stuff. Do not add hashtags. Do not add HTML. Do not hide keywords.',
    'Use the exact entity name "Taylor Drew" and the phrase "New York City stand-up comedian" only when natural for this field.',
    ...(geo
      ? [
          'Make the result a dense, self-contained semantic block that still makes sense when extracted from the page.',
          'Answer the likely visitor question first. Name Taylor Drew instead of relying on pronouns.',
          'Prefer specific verified facts from the supplied context because AI answer engines need claims they can attribute.',
          'Do not add a freshness date unless the original text contains a real date or update.'
        ]
      : [
          'Use likely search wording naturally, especially in the opening sentence, without repeating phrases for ranking.'
        ]),
    'Keep a short label or title short. Keep a paragraph close to its original length unless clarity needs a little more room.',
    'Return only the rewritten field in the required JSON shape.',
    `Field label: ${label || 'Text'}`,
    `Field path: ${path || 'unknown'}`,
    `Current text: ${text}`,
    `Known facts: ${JSON.stringify(factualContext(site))}`
  ].join('\n');
}

async function rewrite({ text, path, label, site, mode = 'seo', env = process.env }) {
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
      messages: [{ role: 'user', content: instruction({ text: source, path, label, site, mode }) }]
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

async function describePhoto({ buffer, contentType, target, site, env = process.env }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw Object.assign(new Error('Choose a photo first.'), { status: 400 });
  }
  if (!IMAGE_TYPES.includes(contentType)) {
    throw Object.assign(new Error('Photo SEO works with PNG, JPEG, WebP or GIF images.'), { status: 415 });
  }
  if (buffer.length > 5 * 1024 * 1024) {
    throw Object.assign(new Error('That photo is over 5 MB. Use a smaller copy.'), { status: 413 });
  }
  const key = apiKey(env, site);
  if (!key) {
    throw Object.assign(new Error('Photo SEO needs the Anthropic API key under Shows → Post a flyer.'), { status: 400 });
  }

  const client = new Anthropic({ apiKey: key, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: 1, timeout: 25000 });
  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: contentType, data: buffer.toString('base64') } },
          { type: 'text', text: [
            'Write accurate alt text for this photo on Taylor Drew’s official website.',
            'Describe what is visibly present in one natural sentence, usually 12 to 30 words.',
            'Use “Taylor Drew” if Taylor is the clear subject. Mention “New York City stand-up comedian” only if the image itself supports that context.',
            'Do not identify another person, guess a venue, invent an event, list keywords, add hashtags, or write promotional claims.',
            'Do not start with “image of” or “photo of”. Return only the alt text in the required JSON shape.',
            `Destination field: ${String(target || '').slice(0, 160)}`
          ].join('\n') }
        ]
      }]
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw Object.assign(new Error('Anthropic rejected the API key.'), { status: 400 });
    if (err instanceof Anthropic.RateLimitError) throw Object.assign(new Error('Anthropic is busy right now. Try again in a minute.'), { status: 429 });
    if (err instanceof Anthropic.APIConnectionTimeoutError) throw Object.assign(new Error('Photo SEO took too long. Try again.'), { status: 504 });
    throw Object.assign(new Error(`Could not analyze the photo: ${err.message}`), { status: 502 });
  }
  if (response.stop_reason === 'refusal') throw Object.assign(new Error('The model declined to analyze that photo.'), { status: 422 });
  const raw = (response.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('');
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) {
    throw Object.assign(new Error('The model did not return usable alt text. Try again.'), { status: 502 });
  }
  const text = String((parsed && parsed.text) || '').trim().slice(0, 500);
  if (!text) throw Object.assign(new Error('The model returned empty alt text.'), { status: 502 });
  return text;
}

module.exports = { rewrite, describePhoto, instruction, factualContext, MODEL, IMAGE_TYPES };
