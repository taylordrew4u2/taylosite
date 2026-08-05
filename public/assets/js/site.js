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
