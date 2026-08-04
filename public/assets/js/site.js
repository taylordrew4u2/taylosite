/* Public site behaviour: theme switching and the mobile menu. */
(function () {
  'use strict';

  var root = document.documentElement;
  var STORAGE_KEY = 'td-theme';

  function markActive() {
    var current = root.getAttribute('data-theme');
    document.querySelectorAll('.theme-btn').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.themeId === current);
      btn.setAttribute('aria-pressed', String(btn.dataset.themeId === current));
    });
  }

  document.querySelectorAll('.theme-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      root.setAttribute('data-theme', btn.dataset.themeId);
      try {
        localStorage.setItem(STORAGE_KEY, btn.dataset.themeId);
      } catch (e) {
        /* private mode — the choice just won't stick */
      }
      markActive();
    });
  });

  markActive();

  var toggle = document.querySelector('.menu-toggle');
  var topbar = document.querySelector('.topbar');
  if (toggle && topbar) {
    var setOpen = function (open) {
      topbar.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    };

    toggle.addEventListener('click', function () {
      setOpen(!topbar.classList.contains('is-open'));
    });

    // Following a link or pressing Escape should put the menu away again.
    topbar.addEventListener('click', function (event) {
      if (event.target.closest('.nav-link, .btn-admin')) setOpen(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && topbar.classList.contains('is-open')) {
        setOpen(false);
        toggle.focus();
      }
    });
  }
})();
