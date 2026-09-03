/* Public site behaviour: the mobile menu. */
(function () {
  'use strict';

  var toggle = document.querySelector('.menu-toggle');
  var topbar = document.querySelector('.topbar');
  if (!toggle || !topbar) return;

  function setOpen(open) {
    topbar.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }

  toggle.addEventListener('click', function () {
    setOpen(!topbar.classList.contains('is-open'));
  });

  // Following a link or pressing Escape should put the menu away again.
  topbar.addEventListener('click', function (event) {
    if (event.target.closest('.nav-link')) setOpen(false);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && topbar.classList.contains('is-open')) {
      setOpen(false);
      toggle.focus();
    }
  });
})();

/* The reel wall: play only what is on screen.

   Twenty videos all decoding at once will stall a phone and burn its battery,
   and a tile nobody can see does not need to be playing. An IntersectionObserver
   starts each one as it comes into view and pauses it as it leaves; where the
   browser has none, the markup's own `autoplay` already covers it. */
(function () {
  'use strict';

  var reels = document.querySelectorAll('.page-reels video.reel-media');
  if (!reels.length || typeof IntersectionObserver !== 'function') return;

  // Someone who asked for less motion should not be handed a wall of it.
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var observer = new IntersectionObserver(
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
  );

  Array.prototype.forEach.call(reels, function (video) {
    video.removeAttribute('autoplay');
    if (still) video.setAttribute('controls', '');
    observer.observe(video);
  });
})();
