'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { normalizeSite, publicSite } = require('../lib/schema');
const { defaultSite } = require('../lib/defaults');
const render = require('../lib/render');

const base = () => defaultSite();

test('unsafe URL schemes are dropped', () => {
  const site = normalizeSite(
    {
      links: {
        items: [
          { id: 'a', label: 'Bad', url: 'javascript:alert(1)' },
          { id: 'b', label: 'Data', url: 'data:text/html,<script>x</script>' },
          { id: 'c', label: 'VB', url: 'vbscript:msgbox' }
        ]
      }
    },
    base()
  );
  assert.deepStrictEqual(site.links.items.map((l) => l.url), ['', '', '']);
});

test('safe URL schemes survive, and bare domains gain https://', () => {
  const site = normalizeSite(
    {
      links: {
        items: [
          { id: 'a', label: 'A', url: 'https://example.com/x' },
          { id: 'b', label: 'B', url: 'mailto:hi@example.com' },
          { id: 'c', label: 'C', url: 'tel:+15550001111' },
          { id: 'd', label: 'D', url: '/about' },
          { id: 'e', label: 'E', url: 'example.com/list' }
        ]
      }
    },
    base()
  );
  assert.deepStrictEqual(site.links.items.map((l) => l.url), [
    'https://example.com/x',
    'mailto:hi@example.com',
    'tel:+15550001111',
    '/about',
    'https://example.com/list'
  ]);
});

test('image fields refuse anything that is not an upload or an https URL', () => {
  const site = normalizeSite(
    { home: { photo: 'javascript:alert(1)' }, about: { photo: '../../etc/passwd' }, seo: { ogImage: 'https://cdn.example.com/a.jpg' } },
    base()
  );
  assert.strictEqual(site.home.photo, '');
  assert.strictEqual(site.about.photo, '');
  assert.strictEqual(site.seo.ogImage, 'https://cdn.example.com/a.jpg');
});

test('click counts come from the server, never from the request', () => {
  const current = base();
  current.links.items = [{ id: 'link-a', label: 'A', url: 'https://a.example', visible: true, featured: false, clicks: 42 }];

  const site = normalizeSite({ links: { items: [{ id: 'link-a', label: 'A renamed', url: 'https://a.example', clicks: 99999 }] } }, current);

  assert.strictEqual(site.links.items[0].clicks, 42, 'a forged count must be ignored');
  assert.strictEqual(site.links.items[0].label, 'A renamed', 'but ordinary edits still apply');
});

test('credentials are never taken from the payload', () => {
  const current = base();
  current.auth = { hash: 'realhash', salt: 'realsalt', updatedAt: null };
  const site = normalizeSite({ auth: { hash: 'attacker', salt: 'attacker' } }, current);
  assert.deepStrictEqual(site.auth, current.auth);
});

test('publicSite strips credentials', () => {
  const site = base();
  site.auth = { hash: 'secret', salt: 'pepper' };
  assert.strictEqual(publicSite(site).auth, undefined);
  assert.ok(site.auth, 'the original document is left intact');
});

test('text is length-capped and trimmed', () => {
  const site = normalizeSite({ brand: { name: '  ' + 'x'.repeat(500) + '  ' } }, base());
  assert.strictEqual(site.brand.name.length, 120);
  assert.ok(!site.brand.name.startsWith(' '));
});

test('theme colours must be hex, and fall back when they are not', () => {
  const current = base();
  const site = normalizeSite(
    { themes: { options: [{ id: 'A', name: 'Red', bg: 'url(evil)', accent: '#00FF00' }] } },
    current
  );
  assert.strictEqual(site.themes.options[0].bg, current.themes.options[0].bg, 'invalid colour falls back');
  assert.strictEqual(site.themes.options[0].accent, '#00ff00', 'valid colour is kept, lowercased');
});

test('the default theme must name a theme that exists', () => {
  const site = normalizeSite({ themes: { default: 'ZZ' } }, base());
  assert.ok(site.themes.options.some((o) => o.id === site.themes.default));
});

test('list lengths are bounded', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ id: `l${i}`, label: `L${i}`, url: 'https://e.example' }));
  const site = normalizeSite({ links: { items: many }, nav: many }, base());
  assert.strictEqual(site.links.items.length, 100);
  assert.strictEqual(site.nav.length, 12);
});

test('show dates must be ISO calendar dates', () => {
  const site = normalizeSite(
    { shows: [{ id: 's1', date: '2027-03-14', venue: 'A' }, { id: 's2', date: 'tomorrow', venue: 'B' }] },
    base()
  );
  assert.strictEqual(site.shows[0].date, '2027-03-14');
  assert.strictEqual(site.shows[1].date, '');
});

test('a garbage payload still yields a usable document', () => {
  for (const junk of [null, undefined, 'string', 42, [], { links: 'nope' }, { home: [] }]) {
    const site = normalizeSite(junk, base());
    assert.ok(site.brand.name, `survived ${JSON.stringify(junk)}`);
    assert.ok(Array.isArray(site.links.items));
    assert.ok(Array.isArray(site.shows));
    assert.ok(site.themes.options.length);
  }
});

test('an emptied URL field is cleared, not silently kept', () => {
  const { normalizeSite } = require('../lib/schema');
  const before = normalizeSite(
    {
      reels: { feedUrl: 'https://example.com/feed.json' },
      home: { photo: '/uploads/hero.png' },
      footer: { rightHref: 'mailto:a@b.c' },
      links: { items: [{ id: 'l1', label: 'One', url: 'https://one.example' }] }
    },
    null
  );

  const cleared = normalizeSite(
    {
      reels: { feedUrl: '' },
      home: { photo: '' },
      footer: { rightHref: '' },
      links: { items: [{ id: 'l1', label: 'One', url: '' }] }
    },
    before
  );
  assert.strictEqual(cleared.reels.feedUrl, '', 'a feed URL can be removed');
  assert.strictEqual(cleared.home.photo, '', 'a photo can be removed');
  assert.strictEqual(cleared.footer.rightHref, '', 'a footer link can be removed');
  assert.strictEqual(cleared.links.items[0].url, '', 'a link can be emptied');

  // A key that simply is not in the payload still falls back — partial saves.
  const partial = normalizeSite({ brand: { name: 'Taylor Drew' } }, before);
  assert.strictEqual(partial.reels.feedUrl, 'https://example.com/feed.json');
  assert.strictEqual(partial.home.photo, '/uploads/hero.png');

  // Controls that would break if pointed nowhere keep a target.
  assert.strictEqual(normalizeSite({ nav: [{ id: 'n', label: 'N', href: '' }] }, before).nav[0].href, '/');
  assert.strictEqual(
    normalizeSite({ home: { primaryCta: { label: 'Go', href: '' } } }, before).home.primaryCta.href,
    before.home.primaryCta.href,
    'a button keeps its destination'
  );
});

test('a show keeps its flyer only when it is an upload or an https URL', () => {
  const site = normalizeSite(
    {
      shows: [
        { id: 'a', venue: 'A', flyer: '/uploads/flyer-1a2b3c4d.png' },
        { id: 'b', venue: 'B', flyer: 'https://cdn.example.com/b.jpg' },
        { id: 'c', venue: 'C', flyer: 'javascript:alert(1)' },
        { id: 'd', venue: 'D' }
      ]
    },
    base()
  );
  assert.deepStrictEqual(site.shows.map((s) => s.flyer), ['/uploads/flyer-1a2b3c4d.png', 'https://cdn.example.com/b.jpg', '', '']);
});

// The live site published `addressRegion: "additionally k"` and
// `gender: "Female — Taylor Drew, a New York City st"` after generated prose
// reached two fields that hold exact facts. The generator is guarded now; this
// is the second line, so that overlong text can only ever shorten a truth.
test('identity facts are trimmed on a word boundary, never mid-word', () => {
  const sentence = 'New York City — Taylor Drew is a New York City stand-up comedian who performs regularly at top NYC clubs, additionally known for roast battles';
  const saved = normalizeSite({ brand: { location: sentence, gender: 'Female — Taylor Drew, a New York City stand-up comedian' } }, defaultSite()).brand;

  assert.ok(saved.location.length <= 120);
  assert.ok(saved.gender.length <= 40);
  assert.ok(sentence.startsWith(saved.location), 'a trimmed location is still a prefix of what was sent');
  assert.doesNotMatch(saved.location, /[\s,;:–—-]$/, 'never ends on a dangling separator');
  // The cut lands between words: what follows the kept prefix is whitespace.
  assert.match(sentence.slice(saved.location.length), /^\s/, 'the last word is whole');
  assert.equal(saved.location.endsWith('additionally'), true);
  assert.equal(saved.gender, 'Female — Taylor Drew, a New York City');

  // A real value is untouched.
  const normal = normalizeSite({ brand: { location: 'New York City', gender: 'Female' } }, defaultSite()).brand;
  assert.equal(normal.location, 'New York City');
  assert.equal(normal.gender, 'Female');
});

// The exact values the live site was publishing. Visible copy keeps whatever
// was saved — the mistake should stay plain to whoever edits the page — but the
// machine-readable graph must never assert a coined fact, because an answer
// engine has no way to tell one from a real one.
test('structured data publishes a clean identity even when the stored value is prose', () => {
  const site = normalizeSite({ brand: {
    name: 'Taylor Drew',
    accentLabel: 'Stand-up comedian',
    email: 'taylordrew4u@gmail.com',
    location: 'New York City — Taylor Drew is a New York City stand-up comedian who performs regularly at top NYC clubs, additionally k',
    gender: 'Female — Taylor Drew, a New York City st'
  } }, defaultSite());

  const html = render.renderHome(site, { origin: 'https://example.com' });
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  const person = graph.find((node) => String(node['@type']).includes('Person'));

  assert.strictEqual(person.gender, 'Female');
  assert.strictEqual(person.homeLocation.name, 'New York City');
  assert.strictEqual(person.address.addressLocality, 'New York City');
  assert.strictEqual(person.address.addressRegion, undefined, 'never invents a region out of a half sentence');
  assert.strictEqual(person.contactPoint.areaServed, 'New York City');
  assert.strictEqual(person.hasOccupation.occupationLocation.name, 'New York City');
  assert.strictEqual(person.disambiguatingDescription, 'Stand-up comedian based in New York City');
  assert.ok(!JSON.stringify(graph).includes('additionally k'), 'no fragment of the overwritten value survives');

  // llms.txt is read by answer engines, so it gets the same treatment.
  assert.match(render.llmsTxt(site, 'https://example.com'), /^> Stand-up comedian · New York City$/m);

  // A value that was never damaged is published exactly as saved.
  const clean = normalizeSite({ brand: { location: 'Brooklyn, New York', gender: 'Female' } }, defaultSite());
  const cleanPerson = JSON.parse(render.renderHome(clean, { origin: 'https://example.com' })
    .match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph']
    .find((node) => String(node['@type']).includes('Person'));
  assert.strictEqual(cleanPerson.gender, 'Female');
  assert.strictEqual(cleanPerson.homeLocation.name, 'Brooklyn, New York');
  assert.strictEqual(cleanPerson.address.addressLocality, 'Brooklyn');
  assert.strictEqual(cleanPerson.address.addressRegion, 'New York');
});
