'use strict';

/**
 * A show, read off its flyer.
 *
 * The admin panel posts the flyer image; this sends it to Claude with a fixed
 * schema and gets back the fields a show row is made of — date, time, venue,
 * city, address, ticket link, note. The panel adds the row; the flyer itself
 * is kept as an upload and attached to the show.
 *
 * Credentials, in order:
 *   site.auth.anthropic.apiKey   pasted into the panel (Shows → Post a flyer)
 *   ANTHROPIC_API_KEY            environment
 *
 * ANTHROPIC_BASE_URL is honoured by the SDK, which is how the tests stand in a
 * fake for the real service.
 */

const ai = require('./ai-providers');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

// What the vision API accepts. Anything else is refused before it costs a call.
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'date', 'time', 'venue', 'city', 'street', 'postalCode', 'country', 'url', 'note', 'soldOut', 'confidence', 'missing'],
  properties: {
    title: { type: 'string', description: 'The show or event name as printed, or empty' },
    date: { type: 'string', description: 'YYYY-MM-DD, or empty if the flyer has no date' },
    time: { type: 'string', description: 'Start or door time as printed, e.g. "8:00 PM"; empty if none' },
    venue: { type: 'string', description: 'Venue name' },
    city: { type: 'string', description: '"City, ST" for US venues, otherwise "City, Country"' },
    street: { type: 'string', description: 'Street address of the venue if printed, else empty' },
    postalCode: { type: 'string' },
    country: { type: 'string', description: 'Two-letter country code, e.g. US, if it can be told' },
    url: { type: 'string', description: 'Ticket link or website printed on the flyer, as a full URL, else empty' },
    note: { type: 'string', description: 'One short line worth showing under the venue: lineup, age limit, price, "late show". Empty if nothing' },
    soldOut: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    missing: { type: 'array', items: { type: 'string' }, description: 'Field names that could not be read from the flyer' }
  }
};

function apiKey(env = process.env, site = null) {
  const saved = site && site.auth && site.auth.anthropic;
  return String((saved && saved.apiKey) || env.ANTHROPIC_API_KEY || '').trim();
}

/** What the panel gets: whether it can work, and where the key came from. */
function status(site, env = process.env) {
  return ai.status(site, env);
}

async function saveKey({ store, apiKey: key }) {
  const value = String(key == null ? '' : key).trim();
  if (!/^sk-ant-[\w-]{20,}$/.test(value)) throw new Error('That does not look like an Anthropic API key (they start with sk-ant-).');
  await ai.save({ store, provider: 'anthropic', apiKey: value });
}

async function forgetKey(store) {
  await ai.remove({ store, provider: 'anthropic' });
}

function prompt(today, brand) {
  return [
    `This is a flyer for a live show. Read it and fill in the fields for the show listing on ${brand ? `${brand}'s` : 'the performer’s'} website.`,
    `Today is ${today}. Flyers often print a weekday and date without a year: pick the year that puts the show on or after today, and check the weekday matches.`,
    'If the flyer lists several dates for the same run, use the first one that is on or after today and mention the others in the note.',
    'Leave any field you cannot read empty and list it in "missing". Do not invent a venue, time, or link. Quote the ticket URL exactly as printed, adding https:// if it is bare.'
  ].join('\n');
}

/**
 * Read a flyer. Resolves to the schema above, always with every key present.
 * Throws with a message the panel can show as-is.
 */
async function extract({ buffer, contentType, env = process.env, site = null, today = new Date().toISOString().slice(0, 10) }) {
  if (!IMAGE_TYPES.includes(contentType)) throw Object.assign(new Error('A flyer has to be a PNG, JPEG, WebP or GIF image.'), { status: 415 });
  if (buffer.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('That flyer is over 5 MB. A phone screenshot of it is plenty.'), { status: 413 });

  const brand = site && site.brand && site.brand.name;

  let response;
  try {
    response = await ai.create({ site, env, request: {
      model: MODEL,
      max_tokens: 2048,
      // Reading a poster is not a hard problem, and low effort is what keeps
      // the answer inside a serverless function's time budget.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: contentType, data: buffer.toString('base64') } },
            { type: 'text', text: prompt(today, brand) }
          ]
        }
      ]
    } });
  } catch (err) {
    throw Object.assign(new Error(`Could not read the flyer: ${err.message}`), { status: err.status || 502 });
  }

  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error('The model declined to read that image.'), { status: 422 });
  }
  const text = (response.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    throw Object.assign(new Error('The model did not answer with the show details. Try again.'), { status: 502 });
  }
  return normalize(parsed);
}

const clean = (value, max) => String(value == null ? '' : value).trim().slice(0, max);

/** Coerce whatever came back into exactly the shape the panel expects. */
function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(src.date || '')) ? String(src.date) : '';
  let url = clean(src.url, 600);
  if (url && !/^https?:\/\//i.test(url)) url = /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url) ? `https://${url}` : '';
  const missing = Array.isArray(src.missing) ? src.missing.map((m) => clean(m, 30)).filter(Boolean) : [];
  if (!date && !missing.includes('date')) missing.push('date');
  if (!clean(src.venue, 120) && !missing.includes('venue')) missing.push('venue');
  return {
    title: clean(src.title, 120),
    date,
    time: clean(src.time, 20),
    venue: clean(src.venue, 120),
    city: clean(src.city, 120),
    street: clean(src.street, 160),
    postalCode: clean(src.postalCode, 20),
    country: clean(src.country, 60),
    url,
    note: clean(src.note, 200),
    soldOut: src.soldOut === true,
    confidence: ['high', 'medium', 'low'].includes(src.confidence) ? src.confidence : 'low',
    missing
  };
}

module.exports = { extract, normalize, status, saveKey, forgetKey, apiKey, IMAGE_TYPES, MAX_IMAGE_BYTES, MODEL, SCHEMA };
