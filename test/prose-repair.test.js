'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pr = require('../lib/prose-repair');

// The description the generator left on the live site: the wrong pronoun twice
// over, and a final sentence that merges three unrelated facts and then stops
// mid-clause. The biography beside it, and the site's own gender field, both
// say she.
const DESCRIPTION = 'Taylor Drew is a New York City stand-up comedian who performs regularly at top NYC clubs. He has been featured at the Comedy Store in Los Angeles and festivals including Skankfest, Edinburgh Fringe, Laughing Buddha Comedy Festival. Taylor Drew won the Roast Battle competition at the League of Comics event. He also judges on SAG-Eligible performer Orange Is the New,';

test('the description keeps her pronouns and loses the sentence that stops mid-clause', () => {
  const out = pr.repairDescription(DESCRIPTION, 'Female');

  assert.doesNotMatch(out, /\bHe\b|\bhis\b|\bhim\b/, 'no masculine pronoun survives');
  assert.match(out, /\bShe has been featured\b/);
  assert.doesNotMatch(out, /Orange Is the New,/, 'the unfinished, garbled sentence is dropped');
  assert.match(out, /[.!?]$/, 'what is left ends on a complete sentence');
  // Nothing is added: every sentence kept was already there.
  for (const sentence of pr.sentences(out)) {
    assert.ok(DESCRIPTION.includes(sentence.replace(/\bShe\b/, 'He')) || DESCRIPTION.includes(sentence), sentence);
  }
});

test('pronouns are only corrected when the site states a feminine gender', () => {
  assert.match(pr.repairDescription(DESCRIPTION, ''), /\bHe has been featured\b/, 'no gender stated, no correction');
  assert.match(pr.repairDescription(DESCRIPTION, 'Male'), /\bHe has been featured\b/);
  assert.doesNotMatch(pr.repairDescription(DESCRIPTION, 'She/her'), /\bHe\b/);
  // The truncated sentence goes either way — that is damage, not a pronoun.
  assert.doesNotMatch(pr.repairDescription(DESCRIPTION, ''), /Orange Is the New,/);
});

test('a title containing a question mark is never split into two sentences', () => {
  const credit = 'Oh Shit, Did We Just Kill a Guy? (USA) earned Best Writer award at Alternative Film Festival.';
  assert.deepEqual(pr.sentences(credit), [credit], 'the film title survives intact');
  assert.deepEqual(pr.sentences('One thing. Then another.'), ['One thing.', 'Then another.']);
});

test('a sentence repeated across the biography is kept once, in its first place', () => {
  const body = [
    'Taylor Drew is a stand-up comedian based in New York City. Her credits include Orange Is the New Black.',
    'Her credits include Orange Is the New Black. Taylor performs at clubs across the city. Her credits include Orange Is the New Black.'
  ];
  const out = pr.repairBody(body);

  assert.equal(out.length, 2);
  assert.equal(out[0], body[0], 'the first paragraph is untouched');
  assert.equal(out[1], 'Taylor performs at clubs across the city.');
  assert.equal((out.join(' ').match(/Her credits include/g) || []).length, 1);
});

test('interface metadata is not biography', () => {
  const out = pr.repairBody(['Taylor Drew performs in New York City. Primary button label: Performers.']);
  assert.deepEqual(out, ['Taylor Drew performs in New York City.']);

  // A paragraph that was nothing but duplication and noise is removed entirely.
  assert.deepEqual(pr.repairBody(['One sentence here.', 'One sentence here. Button label: Go.']), ['One sentence here.']);
});

test('a shipped fact is restored from its own id, and an edited one is left alone', () => {
  const facts = [
    { id: 'fact-base', label: 'Based in New York City, Taylor Drew is a stand-up comedian w', value: 'New York City, Taylor Drew is a stand-up comedian based in New York City. Known for performing regularly at top NYC clubs, Taylor draws audiences with her uniqu' },
    { id: 'fact-booking', label: 'Booking', value: 'taylordrew4u@gmail.com' },
    { id: 'fact-custom', label: 'Represented by', value: 'A long answer that the site never shipped a default for, so it is nobody else business' }
  ];
  const out = pr.repairFacts(facts);

  assert.deepEqual(out[0], { id: 'fact-base', label: 'Based in', value: 'New York City' });
  assert.deepEqual(out[1], facts[1], 'an undamaged fact is untouched');
  assert.deepEqual(out[2], facts[2], 'a fact the site never shipped is never overwritten');
});

test('clean content is left exactly as it is', () => {
  const site = {
    seo: { description: 'Taylor Drew is a New York City stand-up comedian. Dates, clips and booking.' },
    brand: { gender: 'Female' },
    about: {
      body: ['Taylor Drew performs stand-up in New York City.', 'She won the Skankfest Roast Battle in 2025.'],
      facts: [{ id: 'fact-base', label: 'Based in', value: 'New York City' }]
    }
  };
  const before = JSON.parse(JSON.stringify(site));
  const { changes } = pr.apply(site);

  assert.deepEqual(changes, [], 'nothing to repair means nothing rewritten');
  assert.equal(site.seo.description, before.seo.description);
  assert.deepEqual(site.about.body, before.about.body);
  assert.deepEqual(site.about.facts, before.about.facts);
});

test('it runs once and never reverts a later edit', async () => {
  const site = {
    seo: { description: DESCRIPTION },
    brand: { gender: 'Female' },
    about: { body: ['A. A.'], facts: [] }
  };
  pr.apply(site);
  assert.equal(pr.alreadyRun(site), true);
  assert.deepEqual(site.meta.repairs, [pr.MARKER]);

  let wrote = false;
  assert.equal(await pr.run({ readSite: async () => site, update: async () => { wrote = true; } }), null);
  assert.equal(wrote, false, 'a later cold start does not write');

  // A store that cannot be read never breaks the request path.
  assert.equal(await pr.run({ readSite: async () => { throw new Error('unreachable'); }, update: async () => {} }), null);
});
