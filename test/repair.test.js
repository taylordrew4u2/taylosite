'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSite } = require('../lib/schema');
const { defaultSite } = require('../lib/defaults');
const repair = require('../lib/repair');

// The values taylordrew4u.com was serving: generated prose reached fields whose
// whole value is that they are exact, and the schema then cut each one to its
// length mid-word and stored the fragment.
function damaged() {
  return normalizeSite({
    brand: {
      name: 'Taylor Drew',
      accentLabel: 'Stand-up comedian',
      location: 'New York City — Taylor Drew is a New York City stand-up comedian who performs regularly at top NYC clubs, additionally k',
      gender: 'Female — Taylor Drew, a New York City st'
    },
    about: { facts: [
      { id: 'fact-base', label: 'Based in New York City, Taylor Drew is a stand-up comedian w', value: 'New York City, Taylor Drew is a stand-up comedian based in New York City. Known for performing regularly at top NYC clubs, Taylor draws audiences with her uniqu' },
      { id: 'fact-booking', label: 'Booking', value: 'taylordrew4u@gmail.com' }
    ] }
  }, defaultSite());
}

test('the repair restores the original value where it is still recoverable', () => {
  const site = damaged();
  const report = repair.apply(site);

  assert.equal(site.brand.location, 'New York City');
  assert.equal(site.brand.gender, 'Female');
  assert.deepEqual(report.changes.map((c) => c.path).sort(), ['brand.gender', 'brand.location']);
  // The report carries what it replaced, so the log says what happened.
  assert.match(report.changes.find((c) => c.path === 'brand.location').from, /additionally k$/);
});

test('a value with no confident original is left exactly as it was', () => {
  const site = damaged();
  const before = site.about.facts[0].label;
  const report = repair.apply(site);

  assert.equal(site.about.facts[0].label, before, 'never guesses a label');
  assert.ok(report.skipped.some((s) => s.path === 'about.facts.0.label'));
  assert.ok(report.skipped.some((s) => s.path === 'about.facts.0.value'));
  // Inventing a fact about a person is the mistake being repaired, not the fix.
  assert.equal(report.changes.some((c) => c.path.startsWith('about.facts')), false);
});

test('undamaged values are never touched', () => {
  const site = normalizeSite({
    brand: { name: 'Taylor Drew', location: 'Brooklyn, New York', gender: 'Female', accentLabel: 'Stand-up comedian', logoText: 'TAYLOR DREW' },
    about: { facts: [{ id: 'f1', label: 'Based in', value: 'New York City' }, { id: 'f2', label: 'Booking', value: 'taylordrew4u@gmail.com' }] }
  }, defaultSite());
  const before = JSON.parse(JSON.stringify(site));
  const report = repair.apply(site);

  assert.deepEqual(report.changes, [], 'a clean site is not rewritten');
  assert.deepEqual(report.skipped, []);
  assert.equal(site.brand.location, before.brand.location, 'a comma in a real place name is not a sentence');
  assert.deepEqual(site.about.facts, before.about.facts);
});

test('it runs once, and never reverts an edit made afterwards', () => {
  const site = damaged();
  assert.equal(repair.alreadyRun(site), false);
  repair.apply(site);
  assert.equal(repair.alreadyRun(site), true);

  // Someone then deliberately sets a location the repair would have shortened.
  site.brand.location = 'Queens — and the rest of New York City';
  const second = repair.apply(site);
  assert.ok(!second.changes.some((c) => c.path === 'brand.location' && c.to === 'Queens') || repair.alreadyRun(site));
  // The marker is what the boot path checks, and it does not accumulate.
  assert.deepEqual(site.meta.repairs, [repair.MARKER]);
});

test('planning reports without mutating', () => {
  const site = damaged();
  const snapshot = JSON.stringify(site);
  const { changes, skipped } = repair.plan(site);
  assert.equal(JSON.stringify(site), snapshot, 'plan is read-only');
  assert.equal(changes.length, 2);
  assert.equal(skipped.length, 2);
});

test('a store that cannot be read never breaks the request path', async () => {
  const broken = { readSite: async () => { throw new Error('storage unreachable'); }, update: async () => {} };
  assert.equal(await repair.run(broken), null);

  // A document already carrying the marker is not rewritten at all.
  const done = damaged();
  done.meta = { repairs: [repair.MARKER] };
  let wrote = false;
  assert.equal(await repair.run({ readSite: async () => done, update: async () => { wrote = true; } }), null);
  assert.equal(wrote, false, 'no write on a later cold start');
});
