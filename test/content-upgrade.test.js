'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const up = require('../lib/content-upgrade');
const { quality, altQuality } = require('../public/assets/js/copy-editor');

/** The live document as audited, in the parts this touches. */
function audited() {
  const byPath = new Map(up.FIELDS.map((f) => [f.path, f.was]));
  return {
    brand: { name: 'Taylor Drew' },
    seo: {
      title: byPath.get('seo.title'),
      description: byPath.get('seo.description'),
      ogImageAlt: byPath.get('seo.ogImageAlt')
    },
    home: { subhead: byPath.get('home.subhead'), photoAlt: byPath.get('home.photoAlt') },
    reels: { intro: byPath.get('reels.intro') },
    photos: { intro: '' },
    links: {
      intro: '',
      items: [
        { label: 'Instagram', url: 'https://instagram.com/taylordrew4u', sublabel: '' },
        { label: 'Podcast', url: 'https://podcasts.apple.com/us/podcast/taylordrew4u/id1719827840', sublabel: 'TAYLORDREW4U' },
        { label: 'IMDB', url: 'https://www.imdb.com/name/nm6287452/', sublabel: '' }
      ]
    },
    about: {
      photoAlt: byPath.get('about.photoAlt'),
      body: ['Taylor Drew performs in New York City. Taylor is also a judge on Pins & Needles Comedy. She performs at festivals such as the Comedy Store, Skankfest, and League of Comics.']
    }
  };
}

// Her own credits say: League of Comics — Judge. Pins & Needles Comedy —
// Creator and host. The generated biography had them swapped, which is the one
// defect here that makes an answer engine state something untrue about her.
test('the swapped credit is corrected against her own credits list', () => {
  const site = audited();
  assert.match(site.about.body[0], /judge on Pins & Needles/i, 'the damage is present to begin with');

  up.apply(site);
  const bio = site.about.body.join(' ');

  assert.doesNotMatch(bio, /judge[sd]?\s+on\s+Pins\s*&\s*Needles/i, 'she does not judge her own show');
  assert.match(bio, /created and hosts Pins & Needles Comedy/);
  assert.match(bio, /judges League of Comics/);
  assert.doesNotMatch(bio, /festival[^.]*League of Comics/i, 'League of Comics is not a festival she performs at');
});

test('every replacement lands inside what the field publishes', () => {
  const site = audited();
  up.apply(site);

  for (const [path, value] of [
    ['seo.title', site.seo.title],
    ['seo.description', site.seo.description],
    ['home.subhead', site.home.subhead],
    ['about.body.0', site.about.body[0]],
    ['about.body.1', site.about.body[1]],
    ['reels.intro', site.reels.intro],
    ['links.intro', site.links.intro],
    ['photos.intro', site.photos.intro]
  ]) {
    assert.equal(quality(path, value, site).level, 'good', `${path}: ${quality(path, value, site).reason}`);
  }
  for (const link of site.links.items) {
    assert.equal(quality('links.items.0.sublabel', link.sublabel, site).level, 'good', link.label);
  }
});

// Alt text opening "A person" describes a stock photo. Naming the subject is
// what connects the image to the entity in image search.
test('image descriptions name her, and the truncated one is finished', () => {
  const site = audited();
  assert.match(site.about.photoAlt, /performs regularly at$/, 'it was cut off mid-sentence');

  up.apply(site);

  for (const alt of [site.home.photoAlt, site.about.photoAlt, site.seo.ogImageAlt]) {
    assert.match(alt, /Taylor Drew/, alt);
    assert.doesNotMatch(alt, /^A person/, alt);
    assert.equal(altQuality(alt, site).level, 'good', alt);
  }
  assert.match(site.about.photoAlt, /[.!?]$/);
});

test('a field edited since the audit is never overwritten', () => {
  const site = audited();
  site.seo.title = 'A title I chose myself';
  site.home.subhead = 'And a subhead I wrote.';
  site.links.items[0].sublabel = 'My own description of my Instagram.';

  const { changes, skipped } = up.apply(site);

  assert.equal(site.seo.title, 'A title I chose myself');
  assert.equal(site.home.subhead, 'And a subhead I wrote.');
  assert.equal(site.links.items[0].sublabel, 'My own description of my Instagram.');
  assert.ok(skipped.some((s) => s.path === 'seo.title'));
  assert.ok(changes.some((c) => c.path === 'seo.description'), 'the untouched fields still apply');
});

test('a link the site does not know is left alone', () => {
  const site = audited();
  site.links.items.push({ label: 'Something else', url: 'https://example.com/mine', sublabel: '' });
  up.apply(site);
  assert.equal(site.links.items.at(-1).sublabel, '', 'no description is invented for an unknown link');
});

test('it runs once and a later cold start does not write', async () => {
  const site = audited();
  up.apply(site);
  assert.equal(up.alreadyRun(site), true);
  assert.deepEqual(site.meta.repairs, [up.MARKER]);

  let wrote = false;
  assert.equal(await up.run({ readSite: async () => site, update: async () => { wrote = true; } }), null);
  assert.equal(wrote, false);

  // A second apply on already-upgraded content changes nothing further.
  const again = up.apply(site);
  assert.equal(again.changes.length, 0);
});

test('a store that cannot be read never breaks the request path', async () => {
  assert.equal(await up.run({ readSite: async () => { throw new Error('unreachable'); }, update: async () => {} }), null);
});
