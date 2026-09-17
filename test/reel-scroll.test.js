'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const site = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'site.js'), 'utf8');
const render = require('../lib/render');
const { normalizeSite } = require('../lib/schema');
const { defaultSite } = require('../lib/defaults');

// The content lives in a desktop window, so <main> is the box that scrolls and
// the document never moves. Everything below follows from that, and each of
// these was verified in a real browser against the live page before being
// written down: the wall only grew once you were already at the very bottom,
// and the scroll keys did nothing at all.
test('the scrollable region is reachable from the keyboard', () => {
  const html = render.renderHome(normalizeSite({}, defaultSite()), { origin: 'https://example.com' });
  assert.match(html, /<main class="main" id="main" tabindex="0">/, 'a scrollable region in the tab order');
  assert.doesNotMatch(html, /<main[^>]*tabindex="-1"/);
  assert.match(html, /<a class="skip-link" href="#main">/, 'the skip link still has its target');
});

test('the wall watches the box that actually scrolls, not the page', () => {
  // An observer on the default root measures against the viewport, so its lead
  // time is spent before the sentinel is near the container's scroll end.
  assert.match(site, /function scrollerOf\(/);
  assert.match(site, /root: scroller \|\| null, rootMargin: '800px 0px'/);
  // "Near the end" has to mean the same thing the observer means.
  assert.match(site, /scroller\s*\n?\s*\?\s*scroller\.getBoundingClientRect\(\)\.bottom/);
});

test('a scroll the observer cannot see still grows the wall', () => {
  // A keyboard, a dragged scrollbar and a programmatic jump all move the
  // container without the sentinel crossing into view.
  assert.match(site, /\(scroller \|\| window\)\.addEventListener\('scroll', onScroll, \{ passive: true \}\)/);
  assert.match(site, /\(scroller \|\| window\)\.removeEventListener\('scroll', onScroll\)/, 'and it is let go when the feed ends');
  // It is also the whole mechanism where there is no IntersectionObserver.
  assert.match(site, /var sentinel = hasObserver/);
  assert.match(site, /if \(sentinel\) sentinel\.disconnect\(\)/);
});

test('the scroll keys have something to act on', () => {
  assert.match(site, /var STEP = \{ PageDown: 1, PageUp: -1, Home: 0, End: 0, ' ': 1 \}/);
  assert.match(site, /main\.scrollTop = main\.scrollHeight/);
  // Never taken from a field or a control the key was meant for.
  assert.match(site, /input, textarea, select, button, a, \[contenteditable\], \[tabindex\]/);
  assert.match(site, /event\.metaKey \|\| event\.ctrlKey \|\| event\.altKey/);
  // Nothing to scroll means nothing to hijack.
  assert.match(site, /main\.scrollHeight <= main\.clientHeight \+ 4/);
});

test('a wall that stops is not mistaken for a wall that ended', () => {
  assert.match(site, /More reels — tap to retry/);
});
