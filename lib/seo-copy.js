'use strict';

const ai = require('./ai-providers');
// The same policy the panel draws its buttons from. The panel is a convenience;
// this is the guarantee, because a rewritten brand.location or brand.gender is
// published straight into the Person node that tells every crawler who this is.
const { fieldPolicy, repair } = require('../public/assets/js/copy-editor');

// Alt text is written by looking at the image, so it has no copy policy — but
// the describer must still only ever land in a field that holds alt text.
const ALT_TARGETS = /^(?:home\.photoAlt|about\.photoAlt|seo\.ogImageAlt|shows\.\d+\.flyerAlt|reels\.items\.\d+\.posterAlt|photos\.items\.\d+\.photoAlt)$/;

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const MAX_TEXT = 6000;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: { text: { type: 'string' } }
};

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

function instruction({ text, path, label, site, mode = 'both', maxLength = 0 }) {
  const geo = mode !== 'seo';
  return [
    mode === 'both'
      ? 'Rewrite one public-facing website field for both traditional search engine optimization (SEO) and generative engine optimization (GEO) in a single version.'
      : geo
      ? 'Rewrite one public-facing website field for generative engine optimization (GEO).'
      : 'Rewrite one public-facing website field for traditional search engine optimization (SEO).',
    'The copy must sound like a human wrote it and remain useful to visitors.',
    'Preserve every fact in the original. Never invent an award, credit, date, venue, appearance, quote, relationship, or claim.',
    'Do not keyword-stuff. Do not add hashtags. Do not add HTML. Do not hide keywords.',
    'Use the exact entity name "Taylor Drew" and the phrase "New York City stand-up comedian" only when natural for this field.',
    'Use likely search wording naturally, especially in the opening sentence, without repeating phrases for ranking.',
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
    'For seo.title, aim for a clear title of 50 to 60 characters. For seo.description, aim for a useful summary of 140 to 160 characters. Preserve the meaning and avoid hype.',
    'For a button or navigation label, retain the action and keep it short. For a question, retain question form. For quoted text, preserve the exact quotation.',
    'Return only the rewritten field in the required JSON shape.',
    ...(maxLength ? [`Hard limit: ${maxLength} characters. Finish the last sentence inside that limit rather than stopping mid-thought.`] : []),
    `Field label: ${label || 'Text'}`,
    `Field path: ${path || 'unknown'}`,
    `Current text: ${text}`,
    `Known facts: ${JSON.stringify(factualContext(site))}`
  ].join('\n');
}

async function rewrite({ text, path, label, site, mode = 'both', env = process.env }) {
  const source = String(text == null ? '' : text).trim().slice(0, MAX_TEXT);
  if (!source) throw Object.assign(new Error('Write something first, then generate SEO + GEO.'), { status: 400 });
  // A name, a location, a gender, a date, a venue, a verification token: fields
  // whose whole value is that they are exact. Generated prose in one of them is
  // not a worse sentence, it is a wrong fact, and the schema then cuts it to the
  // field's length mid-word and publishes the fragment as structured data.
  const policy = fieldPolicy(String(path || ''));
  if (!policy) {
    throw Object.assign(
      new Error('That field holds an exact fact and is written by hand, not generated.'),
      { status: 422 }
    );
  }
  let response;
  try {
    response = await ai.create({ site, env, request: {
      model: MODEL,
      max_tokens: Math.min(2048, policy.maxLength + 256),
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: instruction({ text: source, path, label, site, mode, maxLength: policy.maxLength }) }]
    } });
  } catch (err) {
    throw Object.assign(new Error(`Could not generate SEO + GEO copy: ${err.message}`), { status: err.status || 502 });
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
  const result = repair(String((parsed && parsed.text) || ''), policy.maxLength);
  if (!result) throw Object.assign(new Error('The model returned an empty field. Your original was kept.'), { status: 502 });
  return result;
}

async function describePhoto({ buffer, contentType, target, site, env = process.env }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw Object.assign(new Error('Choose a photo first.'), { status: 400 });
  }
  const destination = String(target || '');
  if (!ALT_TARGETS.test(destination)) {
    throw Object.assign(new Error('A photo description can only be written into an image description field.'), { status: 422 });
  }
  if (!IMAGE_TYPES.includes(contentType)) {
    throw Object.assign(new Error('Photo SEO works with PNG, JPEG, WebP or GIF images.'), { status: 415 });
  }
  if (buffer.length > 5 * 1024 * 1024) {
    throw Object.assign(new Error('That photo is over 5 MB. Use a smaller copy.'), { status: 413 });
  }
  let response;
  try {
    response = await ai.create({ site, env, request: {
      model: MODEL,
      max_tokens: 512,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: contentType, data: buffer.toString('base64') } },
          { type: 'text', text: [
            'Write accurate alt text for this photo, flyer or reel cover on Taylor Drew’s official website, useful for accessibility, image search (SEO) and AI answer engines (GEO).',
            'For a flyer, include the visible event name, venue and date when legible. For a performance cover, describe the visible action. Keep it factual and self-contained.',
            'Describe what is visibly present in one natural sentence, usually 12 to 30 words. Keep home, about and social image alt text within 160 characters.',
            'Use “Taylor Drew” if Taylor is the clear subject. Mention “New York City stand-up comedian” only if the image itself supports that context.',
            'Do not identify another person, guess a venue, invent an event, list keywords, add hashtags, or write promotional claims.',
            'Do not start with “image of” or “photo of”. Return only the alt text in the required JSON shape.',
            `Destination field: ${destination}`
          ].join('\n') }
        ]
      }]
    } });
  } catch (err) {
    throw Object.assign(new Error(`Could not analyze the photo: ${err.message}`), { status: err.status || 502 });
  }
  if (response.stop_reason === 'refusal') throw Object.assign(new Error('The model declined to analyze that photo.'), { status: 422 });
  const raw = (response.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('');
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) {
    throw Object.assign(new Error('The model did not return usable alt text. Try again.'), { status: 502 });
  }
  const limit = /^photos\.items\.\d+\.photoAlt$/.test(destination) ? 500 : 160;
  const text = repair(String((parsed && parsed.text) || ''), limit);
  if (!text) throw Object.assign(new Error('The model returned empty alt text.'), { status: 502 });
  return text;
}

module.exports = { rewrite, describePhoto, instruction, factualContext, MODEL, IMAGE_TYPES, ALT_TARGETS };
