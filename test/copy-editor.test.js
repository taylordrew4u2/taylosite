'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fieldPolicy, contextFor, buildMessages, assess, rewrite } = require('../public/assets/js/copy-editor');

function exampleSite() {
  return {
    brand: { name: 'Taylor Drew', accentLabel: 'Stand-up comedian', location: 'New York City', email: 'booking@example.com' },
    seo: { title: 'Taylor Drew | Stand-up comedy', description: 'Find show dates and clips from Taylor Drew.' },
    home: { headline: 'Taylor Drew', subhead: 'Stand-up comedy in New York City.' },
    about: {
      body: [
        'Taylor Drew performs stand-up comedy in New York City.',
        'Watch performance clips and find upcoming live dates.',
        'BIO_PARAGRAPH_THREE_MUST_STAY_OUT'
      ],
      faqs: [
        { question: 'Where can I see Taylor Drew live?', answer: 'See the upcoming show dates.' },
        { question: 'How do I book Taylor Drew?', answer: 'Email booking@example.com with your event details.' }
      ],
      credits: [{ title: 'EXACT_WORK_TITLE', detail: 'EXACT_AWARD_NAME' }],
      quotes: [{ text: 'EXACT_PRESS_QUOTE', source: 'EXACT_PUBLICATION' }]
    },
    links: { items: [
      { label: 'Instagram', sublabel: 'Short performance clips', url: 'https://instagram.com/taylor', id: 'link-one' },
      { label: 'OTHER_LINK_ROW', sublabel: 'OTHER_LINK_DESCRIPTION', url: 'https://other.example/secret-row' }
    ] },
    shows: [
      { venue: 'First Room', city: 'New York City', date: '2026-09-24', note: 'Late show. Ages 18 and older.', url: 'https://tickets.example/first' },
      { venue: 'OTHER_EVENT_VENUE', city: 'OTHER_EVENT_CITY', date: '2099-12-31', note: 'OTHER_EVENT_NOTE', url: 'https://tickets.example/other' }
    ],
    auth: { hash: 'AUTH_HASH_MUST_STAY_OUT', salt: 'AUTH_SALT_MUST_STAY_OUT' },
    ai: { apiKey: 'AI_SECRET_MUST_STAY_OUT' },
    integrations: { accessToken: 'INTEGRATION_SECRET_MUST_STAY_OUT' }
  };
}

function json(value) { return JSON.stringify(value); }

test('copy generation excludes exact facts, quotations and image descriptions', () => {
  for (const path of [
    'brand.name', 'brand.location', 'brand.accentLabel', 'brand.gender',
    'about.quotes.0.text', 'about.quotes.0.source',
    'about.credits.0.title', 'about.credits.0.detail', 'about.facts.0.value',
    'home.photoAlt', 'about.photoAlt', 'seo.ogImageAlt',
    'shows.0.flyerAlt', 'reels.items.0.posterAlt',
    'shows.0.venue', 'shows.0.city', 'shows.0.date',
    'links.items.0.url', 'links.items.0.id', 'nav.0.href'
  ]) {
    assert.equal(fieldPolicy(path), null, path);
  }
  for (const path of ['seo.title', 'seo.description', 'about.body.0', 'about.faqs.0.answer', 'links.items.0.sublabel', 'shows.0.note']) {
    const policy = fieldPolicy(path);
    assert.ok(policy && policy.instruction, path);
  }
  assert.equal(fieldPolicy('seo.title').maxLength, 60);
  assert.equal(fieldPolicy('seo.description').maxLength, 160);
});

test('FAQ context carries only its question and answer without unrelated biography or private data', () => {
  const context = json(contextFor(exampleSite(), 'about.faqs.1.answer'));
  assert.ok(context.includes('How do I book Taylor Drew?'));
  assert.ok(context.includes('Email booking@example.com with your event details.'));
  assert.ok(!context.includes('Taylor Drew performs stand-up comedy in New York City.'));
  assert.ok(!context.includes('BIO_PARAGRAPH_THREE_MUST_STAY_OUT'));
  for (const secret of ['AUTH_HASH_MUST_STAY_OUT', 'AUTH_SALT_MUST_STAY_OUT', 'AI_SECRET_MUST_STAY_OUT', 'INTEGRATION_SECRET_MUST_STAY_OUT']) {
    assert.ok(!context.includes(secret), secret);
  }
});

test('page context uses a bounded biography and only public identity facts', () => {
  const context = json(contextFor(exampleSite(), 'seo.description'));
  assert.ok(context.includes('Taylor Drew performs stand-up comedy in New York City.'));
  assert.ok(context.includes('Watch performance clips and find upcoming live dates.'));
  assert.ok(!context.includes('BIO_PARAGRAPH_THREE_MUST_STAY_OUT'));
  assert.doesNotMatch(context, /AUTH_HASH_MUST_STAY_OUT|AUTH_SALT_MUST_STAY_OUT|AI_SECRET_MUST_STAY_OUT|INTEGRATION_SECRET_MUST_STAY_OUT/);
});

test('link and event context stays with the requested row', () => {
  const site = exampleSite();
  const link = json(contextFor(site, 'links.items.0.sublabel'));
  assert.ok(link.includes('Instagram'));
  assert.ok(link.includes('https://instagram.com/taylor'));
  assert.ok(!link.includes('OTHER_LINK_ROW'));
  assert.ok(!link.includes('Taylor Drew performs stand-up comedy in New York City.'));
  const event = json(contextFor(site, 'shows.0.note'));
  assert.ok(event.includes('First Room'));
  assert.ok(event.includes('2026-09-24'));
  assert.ok(!event.includes('OTHER_EVENT_VENUE'));
  assert.ok(!event.includes('2099-12-31'));
  assert.ok(!event.includes('Taylor Drew performs stand-up comedy in New York City.'));
  assert.doesNotMatch(link + event, /AUTH_HASH_MUST_STAY_OUT|AI_SECRET_MUST_STAY_OUT/);
});

test('messages include field context and retry feedback without changing the site', () => {
  const site = exampleSite();
  const before = json(site);
  const messages = buildMessages({ site, path: 'about.faqs.1.answer', label: 'Answer', text: site.about.faqs[1].answer,
    recent: ['PREVIOUS_GENERATION_TO_AVOID'], retryReason: 'RETRY_REASON_FOR_DUPLICATE' });
  const prompt = json(messages);
  assert.ok(Array.isArray(messages) && messages.length >= 2);
  assert.ok(prompt.includes('How do I book Taylor Drew?'));
  assert.ok(prompt.includes('PREVIOUS_GENERATION_TO_AVOID'));
  assert.ok(prompt.includes('RETRY_REASON_FOR_DUPLICATE'));
  assert.doesNotMatch(prompt, /AUTH_HASH_MUST_STAY_OUT|AI_SECRET_MUST_STAY_OUT|INTEGRATION_SECRET_MUST_STAY_OUT/);
  assert.equal(json(site), before);
});

test('unchanged, punctuation-only and near-copy rewrites are rejected', () => {
  const site = exampleSite();
  const source = 'Taylor Drew is a stand-up comedian based in New York City who performs live comedy and shares clips from upcoming shows.';
  for (const candidate of [
    source,
    source.toUpperCase().replace(/\./g, '!'),
    source.replace('shares clips', 'shares videos')
  ]) {
    assert.ok(assess(candidate, { source, path: 'about.body.0', site }), candidate);
  }
});

test('recent duplicate copy is rejected while useful copy may retain the same person and location', () => {
  const site = exampleSite();
  const source = 'Taylor Drew performs stand-up comedy in New York City.';
  const candidate = 'Find Taylor Drew’s upcoming New York City shows, watch performance clips, and get in touch about booking.';
  assert.equal(assess(candidate, { source, path: 'seo.description', site }), '');
  assert.ok(assess(candidate, { source, path: 'seo.description', site, recent: [candidate] }));
  assert.ok(assess(candidate, { source, path: 'seo.description', site, recent: [{ path: 'home.subhead', text: candidate }] }));
});

test('metadata length limits reject oversized results instead of silently truncating them', () => {
  const site = exampleSite();
  assert.ok(assess('Taylor Drew | ' + 'stand-up comedy '.repeat(5), { source: 'Taylor Drew comedy', path: 'seo.title', site }));
  assert.ok(assess('Upcoming shows, performance clips and booking information. '.repeat(4), { source: 'Taylor Drew comedy', path: 'seo.description', site }));
});

test('a duplicate result is retried once and a useful rewrite is returned without mutating the site', async () => {
  const site = exampleSite();
  const before = json(site);
  const source = 'Taylor Drew performs stand-up comedy in New York City.';
  const candidate = 'Find Taylor Drew’s upcoming New York City shows, watch performance clips, and get in touch about booking.';
  const requests = [];
  const result = await rewrite({ site, path: 'seo.description', label: 'Description', text: source,
    generate: async (request) => { requests.push(request); return { text: requests.length === 1 ? source : candidate }; }
  });
  assert.deepEqual(result, { text: candidate, changed: true });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].temperature, 0.65);
  assert.equal(requests[1].temperature, 0.8);
  assert.notDeepEqual(requests[1].messages, requests[0].messages);
  assert.equal(json(site), before);
});

test('two unusable outputs leave the original text intact', async () => {
  const site = exampleSite();
  const before = json(site);
  const source = 'Taylor Drew performs stand-up comedy in New York City.';
  let calls = 0;
  const result = await rewrite({ site, path: 'seo.description', text: source,
    generate: async () => { calls++; return { text: source }; }
  });
  assert.deepEqual(result, { text: source, changed: false });
  assert.equal(calls, 2);
  assert.equal(json(site), before);
});
