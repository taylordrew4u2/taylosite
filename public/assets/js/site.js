// Keep real destinations in HTML for crawlers and visitors without JavaScript.
// Ordinary clicks use the existing counter; modified clicks keep native behavior.
document.addEventListener('click', function (event) {
  var link = event.target.closest && event.target.closest('a[data-tracked-link]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  var destination = link.getAttribute('href');
  link.setAttribute('href', link.getAttribute('data-tracked-link'));
  setTimeout(function () { link.setAttribute('href', destination); }, 0);
});

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
  if (!more || !hasObserver || typeof fetch !== 'function') return;

  var link = more.querySelector('.reel-more-link');
  var label = link ? link.textContent : '';
  var next = more.getAttribute('data-next') || '';
  var busy = false;
  var seen = {};
  Array.prototype.forEach.call(grid.querySelectorAll('[data-reel]'), function (tile) {
    seen[tile.getAttribute('data-reel')] = true;
  });

  function nearby() {
    var top = more.getBoundingClientRect().top;
    return top < (window.innerHeight || document.documentElement.clientHeight) + 800;
  }

  function finish() {
    next = '';
    sentinel.disconnect();
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
        // Leave the link as it was: a tap tries again.
        busy = false;
        more.classList.remove('is-loading');
        if (link) link.textContent = label;
      });
  }

  var sentinel = new IntersectionObserver(
    function (entries) {
      if (entries.some(function (entry) { return entry.isIntersecting; })) load();
    },
    { rootMargin: '800px 0px' }
  );
  sentinel.observe(more);

  if (link) {
    link.addEventListener('click', function (event) {
      event.preventDefault();
      load();
    });
  }
})();
