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
    toggle.addEventListener('click', function () {
      var open = topbar.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }
})();
