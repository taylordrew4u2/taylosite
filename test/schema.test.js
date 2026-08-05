'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { normalizeSite, publicSite } = require('../lib/schema');
const { defaultSite } = require('../lib/defaults');

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
