// Keep real destinations in HTML for crawlers and visitors without JavaScript.
// Ordinary clicks use the existing counter; modified clicks keep native behavior.
document.addEventListener('click', function (event) {
  var link = event.target.closest && event.target.closest('a[data-tracked-link]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  var destination = link.getAttribute('href');
  link.setAttribute('href', link.getAttribute('data-tracked-link'));
  setTimeout(function () { link.setAttribute('href', destination); }, 0);
});

/* Keyboard scrolling, for a page that does not scroll.

   The content lives in a desktop window, so the box that moves is <main> and
   the document never scrolls at all. That leaves the scroll keys with nothing
   to act on: pressing End or Page Down anywhere on this site did nothing
   whatsoever unless something had already put focus inside that box. The keys
   are forwarded to it, but only while focus is on the page itself — anything
   typed into a field, or aimed at a control, is left alone. */
(function () {
  'use strict';

  var STEP = { PageDown: 1, PageUp: -1, Home: 0, End: 0, ' ': 1 };

  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!(event.key in STEP)) return;

    var target = event.target;
    if (target && target !== document.body && target !== document.documentElement) {
      if (target.closest('input, textarea, select, button, a, [contenteditable], [tabindex]')) return;
    }

    var main = document.getElementById('main');
    if (!main || main.scrollHeight <= main.clientHeight + 4) return;

    if (event.key === 'Home') main.scrollTop = 0;
    else if (event.key === 'End') main.scrollTop = main.scrollHeight;
    else main.scrollTop += STEP[event.key] * Math.max(120, main.clientHeight - 60);
    event.preventDefault();
  });
})();

/* The reel wall: play only what is on screen, and keep the wall growing.

   Twenty videos all decoding at once will stall a phone and burn its battery,
   and a tile nobody can see does not need to be playing. An IntersectionObserver
   starts each one as it comes into view and pauses it as it leaves; where the
   browser has none, the markup's own `autoplay` already covers it.

   The wall is as long as the account. The server sends one page and a real
   link to the next; here that link becomes a sentinel, and as it scrolls into
   view the next page is fetched and dropped into the grid — again and again,
   until the server says there is no more. Without JavaScript the link still
   works as a link, one page per click. */
(function () {
  'use strict';

  var grid = document.querySelector('.page-reels .reel-grid');
  if (!grid) return;
  var hasObserver = typeof IntersectionObserver === 'function';

  // Someone who asked for less motion should not be handed a wall of it.
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var player = hasObserver
    ? new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            var video = entry.target;
            if (entry.isIntersecting && !still) {
              // A refused play is normal (a background tab, a data saver), not an error.
              var playing = video.play();
              if (playing && typeof playing.catch === 'function') playing.catch(function () {});
            } else if (!video.paused) {
              video.pause();
            }
          });
        },
        { rootMargin: '200px 0px', threshold: 0.15 }
      )
    : null;

  function watch(video) {
    if (!player || video.getAttribute('data-watched')) return;
    video.setAttribute('data-watched', '1');
    video.removeAttribute('autoplay');
    if (still) video.setAttribute('controls', '');
    player.observe(video);
  }

  function watchAll() {
    Array.prototype.forEach.call(grid.querySelectorAll('video.reel-media'), watch);
  }
  watchAll();

  // --- the endless part ---------------------------------------------------

  var more = document.querySelector('.page-reels .reel-more');
  if (!more || typeof fetch !== 'function') return;

  /* The wall scrolls inside <main>, not the page — the document itself never
     scrolls at all. That matters twice over. An observer left on the default
     root measures against the viewport, so its 800px of lead time is spent
     long before the sentinel is anywhere near the container's scroll end, and
     the wall only grows once you are already at the very bottom. And a
     keyboard — End, Page Down — moves that container without the pointer ever
     being over it, so nothing fires at the page level and the wall never grows
     at all. Find the box that actually scrolls, and watch that. */
  function scrollerOf(node) {
    var el = node.parentElement;
    while (el && el !== document.documentElement) {
      var style = window.getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 4) return el;
      el = el.parentElement;
    }
    return null;
  }
  var scroller = scrollerOf(more);

  var link = more.querySelector('.reel-more-link');
  var label = link ? link.textContent : '';
  var next = more.getAttribute('data-next') || '';
  var busy = false;
  var seen = {};
  Array.prototype.forEach.call(grid.querySelectorAll('[data-reel]'), function (tile) {
    seen[tile.getAttribute('data-reel')] = true;
  });

  // "Near the end" is measured against whatever is doing the scrolling, so the
  // answer is the same whether that is the container or the page.
  function nearby() {
    var edge = scroller
      ? scroller.getBoundingClientRect().bottom
      : (window.innerHeight || document.documentElement.clientHeight);
    return more.getBoundingClientRect().top < edge + 800;
  }

  function finish() {
    next = '';
    if (sentinel) sentinel.disconnect();
    (scroller || window).removeEventListener('scroll', onScroll);
    if (more.parentNode) more.parentNode.removeChild(more);
  }

  function append(html) {
    var box = document.createElement('div');
    box.innerHTML = html;
    var added = 0;
    while (box.firstChild) {
      var tile = box.firstChild;
      var id = tile.nodeType === 1 ? tile.getAttribute('data-reel') : null;
      if (id && seen[id]) {
        box.removeChild(tile);
        continue;
      }
      if (id) seen[id] = true;
      grid.appendChild(tile);
      added += 1;
    }
    watchAll();
    return added;
  }

  function load() {
    if (busy || !next) return;
    busy = true;
    more.classList.add('is-loading');
    if (link) link.textContent = 'Loading…';

    fetch('/api/reels?after=' + encodeURIComponent(next), { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('page ' + res.status);
        return res.json();
      })
      .then(function (page) {
        append(page.html || '');
        busy = false;
        more.classList.remove('is-loading');
        if (link) link.textContent = label;
        next = page.next || '';
        if (!next) return finish();
        more.setAttribute('data-next', next);
        if (link) link.setAttribute('href', '/reels?after=' + encodeURIComponent(next));
        // A short page leaves the sentinel still in view, and an observer only
        // fires on the way in — so ask again rather than wait for a scroll.
        if (nearby()) load();
      })
      .catch(function () {
        // A wall that stops silently is indistinguishable from a wall that has
        // ended, so say which one this is. The link still works: a tap retries.
        busy = false;
        more.classList.remove('is-loading');
        if (link) link.textContent = 'More reels — tap to retry';
      });
  }

  var sentinel = hasObserver
    ? new IntersectionObserver(
        function (entries) {
          if (entries.some(function (entry) { return entry.isIntersecting; })) load();
        },
        // Rooted in the box that scrolls, so the 800px is real lead time and
        // the next page is already arriving before the last one runs out.
        { root: scroller || null, rootMargin: '800px 0px' }
      )
    : null;
  if (sentinel) sentinel.observe(more);

  // An observer only fires as the sentinel crosses in. A keyboard, a dragged
  // scrollbar and a scroll-to-top all move the container without doing that,
  // so its own scroll events are watched too. This is also the whole mechanism
  // in a browser with no IntersectionObserver.
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    (window.requestAnimationFrame || function (fn) { setTimeout(fn, 60); })(function () {
      ticking = false;
      if (nearby()) load();
    });
  }
  (scroller || window).addEventListener('scroll', onScroll, { passive: true });

  if (link) {
    link.addEventListener('click', function (event) {
      event.preventDefault();
      load();
    });
  }
})();
