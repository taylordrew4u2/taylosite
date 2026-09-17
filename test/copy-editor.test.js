'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fieldPolicy, identityIssue, contextFor, buildMessages, assess, rewrite, repair, score } = require('../public/assets/js/copy-editor');

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
    photos: { title: 'Photos', kicker: 'Photos', intro: 'A few shots from recent sets.', items: [
      { id: 'photo-one', title: 'Closing the late set', photoAlt: 'Taylor Drew holding a microphone on a small club stage', caption: 'The last five minutes of a late set.', credit: 'EXACT_PHOTOGRAPHER_NAME' },
      { id: 'photo-two', title: 'OTHER_PHOTO_TITLE', photoAlt: 'OTHER_PHOTO_ALT', caption: 'OTHER_PHOTO_CAPTION', credit: 'OTHER_PHOTOGRAPHER' }
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
    'links.items.0.url', 'links.items.0.id', 'nav.0.href',
    'photos.items.0.photoAlt', 'photos.items.0.photo', 'photos.items.0.credit'
  ]) {
    assert.equal(fieldPolicy(path), null, path);
  }
  for (const path of ['seo.title', 'seo.description', 'about.body.0', 'about.faqs.0.answer', 'links.items.0.sublabel', 'shows.0.note',
    'photos.items.0.title', 'photos.items.0.caption', 'photos.title', 'photos.kicker', 'photos.intro']) {
    const policy = fieldPolicy(path);
    assert.ok(policy && policy.instruction, path);
  }
  assert.equal(fieldPolicy('seo.title').maxLength, 60);
  assert.equal(fieldPolicy('seo.description').maxLength, 160);
  // A photo title is a sentence about one picture, not the gallery heading, so
  // it must not fall through to the 40-character heading rule.
  assert.equal(fieldPolicy('photos.items.0.title').maxLength, 120);
  assert.equal(fieldPolicy('photos.items.0.caption').maxLength, 300);
  assert.equal(fieldPolicy('photos.title').maxLength, 40);
});

test('gallery photo context stays with its own photo', () => {
  const site = exampleSite();
  const photo = json(contextFor(site, 'photos.items.0.caption'));
  assert.ok(photo.includes('Closing the late set'));
  assert.ok(photo.includes('Taylor Drew holding a microphone on a small club stage'));
  assert.ok(!photo.includes('OTHER_PHOTO_TITLE'));
  assert.ok(!photo.includes('OTHER_PHOTO_CAPTION'));
  assert.ok(!photo.includes('Taylor Drew performs stand-up comedy in New York City.'));
  assert.doesNotMatch(photo, /AUTH_HASH_MUST_STAY_OUT|AI_SECRET_MUST_STAY_OUT/);
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

test('a duplicate result is retried and a useful rewrite is returned without mutating the site', async () => {
  const site = exampleSite();
  const before = json(site);
  const source = 'Taylor Drew performs stand-up comedy in New York City.';
  const candidate = 'Find Taylor Drew’s upcoming New York City shows, watch performance clips, and get in touch about booking.';
  const requests = [];
  const result = await rewrite({ site, path: 'seo.description', label: 'Description', text: source, bestOf: 1,
    generate: async (request) => { requests.push(request); return { text: requests.length === 1 ? source : candidate }; }
  });
  assert.deepEqual(result, { text: candidate, changed: true });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].temperature, 0.35);
  assert.equal(requests[1].temperature, 0.7);
  assert.notDeepEqual(requests[1].messages, requests[0].messages);
  assert.equal(json(site), before);
});

test('short metadata is written twice and the stronger version is kept', async () => {
  const site = exampleSite();
  const source = 'Taylor Drew performs stand-up comedy in New York City.';
  const weak = 'Comedy shows and clips.';
  const strong = 'Catch Taylor Drew live around New York City: upcoming club dates, clips from recent sets, and booking details.';
  const requests = [];
  const result = await rewrite({ site, path: 'seo.description', text: source,
    generate: async (request) => { requests.push(request); return { text: requests.length === 1 ? weak : strong }; }
  });
  assert.equal(requests.length, 2, 'a second version is written to compare against the first');
  assert.match(requests[1].messages[1].content, /equally accurate version/);
  assert.deepEqual(result, { text: strong, changed: true });
});

test('a long paragraph stops at the first usable version', async () => {
  const site = exampleSite();
  let calls = 0;
  const result = await rewrite({ site, path: 'about.body.0', text: site.about.body[0],
    generate: async () => { calls++; return { text: 'Stand-up is where Taylor Drew works, on stages around New York City, between filmed sets and club dates that fill most weeks of the year.' }; }
  });
  assert.equal(calls, 1);
  assert.equal(result.changed, true);
});

test('scoring prefers a complete, distinct, well-sized version over a thin or stuffed one', () => {
  const site = exampleSite();
  const source = 'Taylor Drew performs stand-up comedy in New York City.';
  const context = { source, path: 'seo.description', site };
  const strong = 'Catch Taylor Drew live around New York City: upcoming club dates, clips from recent sets, and booking details.';
  assert.ok(score(strong, context) > score('Comedy shows and clips.', context), 'a thin version loses');
  assert.ok(score(strong, context) > score(source, context), 'a near-copy of the original loses');
  assert.ok(score(strong, context) > score('Comedy, comedy and more comedy from a comedy comedian in New York City comedy clubs today.', context), 'a stuffed version loses');
});

test('unusable outputs are retried a few times and then leave the original text intact', async () => {
  const site = exampleSite();
  const before = json(site);
  const source = 'Taylor Drew performs stand-up comedy in New York City.';
  let calls = 0;
  const result = await rewrite({ site, path: 'seo.description', text: source,
    generate: async () => { calls++; return { text: source }; }
  });
  assert.deepEqual(result, { text: source, changed: false });
  assert.equal(calls, 3);
  assert.equal(json(site), before);
});

test('model wrappers are stripped and an overlong result is trimmed on a boundary', () => {
  assert.equal(repair('```json\nHere is the rewritten version: "Upcoming Shows"\n```', 60), 'Upcoming Shows');
  assert.equal(repair('**Watch Clips** (12 characters)', 40), 'Watch Clips');
  assert.equal(repair('Taylor Drew performs stand-up around New York City. Watch clips from recent sets and find the next date.', 60),
    'Taylor Drew performs stand-up around New York City.');
  assert.equal(repair('Taylor Drew — New York City stand-up comedian and writer', 40), 'Taylor Drew — New York City stand-up');
  assert.equal(repair('  spaced   out\ntext  ', 60), 'spaced out text');
});

test('a rewrite that only overruns its limit is repaired instead of discarded', async () => {
  const site = exampleSite();
  const source = 'Taylor Drew performs stand-up comedy in New York City.';
  const verbose = '"Catch Taylor Drew live across New York City comedy clubs. Watch clips from recent sets, check the next dates, and send booking details through the contact form today."';
  let calls = 0;
  const result = await rewrite({ site, path: 'seo.description', text: source, bestOf: 1, generate: async () => { calls++; return { text: verbose }; } });
  assert.equal(calls, 1);
  assert.equal(result.changed, true);
  assert.ok(result.text.length <= 160);
  assert.ok(result.text.startsWith('Catch Taylor Drew live'));
  assert.doesNotMatch(result.text, /^"|"$/);
});

// These are the values the live site was publishing after generated prose
// reached two fields that hold exact facts. Person.gender read
// "Female — Taylor Drew, a New York City st" and addressRegion read
// "additionally k". The panel flags exactly this shape now.
test('an identity field holding a sentence is flagged, with the original value offered back', () => {
  const location = identityIssue('brand.location', 'New York City — Taylor Drew is a New York City stand-up comedian who performs regularly at top NYC clubs');
  assert.ok(location, 'a location that runs into a biography is flagged');
  assert.equal(location.suggestion, 'New York City');

  const gender = identityIssue('brand.gender', 'Female — Taylor Drew, a New York City');
  assert.ok(gender);
  assert.equal(gender.suggestion, 'Female');

  // No confident original to offer back: warn, but never invent the fix.
  const fact = identityIssue('about.facts.0.label', 'Based in New York City, Taylor Drew is a stand-up comedian w');
  assert.ok(fact, 'a fact label that became prose is flagged');
  assert.equal(fact.suggestion, '');

  assert.ok(identityIssue('shows.0.venue', 'The Bell House. Taylor Drew performs there often.'), 'a sentence boundary is prose');
});

test('real identity values and ordinary copy are never flagged', () => {
  for (const [path, value] of [
    ['brand.name', 'Taylor Drew'],
    ['brand.location', 'New York City'],
    ['brand.location', 'Brooklyn, New York'],
    ['brand.gender', 'Female'],
    ['brand.gender', 'Non-binary'],
    ['brand.logoText', 'TAYLOR DREW'],
    ['brand.accentLabel', 'Stand-up comedian'],
    ['about.facts.0.label', 'Based in'],
    ['about.facts.0.label', 'Booking'],
    ['shows.0.venue', 'The Bell House'],
    ['shows.0.city', 'Staten Island'],
    ['brand.location', ''],
    ['brand.gender', null]
  ]) {
    assert.equal(identityIssue(path, value), null, `${path} = ${JSON.stringify(value)}`);
  }
  // Fields that are supposed to hold sentences are not identity fields at all.
  for (const path of ['seo.description', 'about.body.0', 'home.subhead', 'photos.items.0.caption']) {
    assert.equal(identityIssue(path, 'Taylor Drew is a stand-up comedian. She performs in New York City.'), null, path);
  }
});
