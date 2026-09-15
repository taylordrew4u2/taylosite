/* The desktop: the parts of the window that only a running machine can do.
 *
 * Everything here is decoration over a site that already works. The pages are
 * rendered on the server and the menu is a list of real links, so with
 * scripting off the window simply sits open on the wallpaper — no clock, no
 * start menu, no splash, and nothing missing. Each block below guards its own
 * elements and returns if they are not there.
 */

/* ------------------------------------------------------------ the clock */
(function () {
  'use strict';

  var clock = document.querySelector('.clock');
  if (!clock) return;

  function tick() {
    var now = new Date();
    var hour = now.getHours();
    var meridiem = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    clock.textContent = hour + ':' + String(now.getMinutes()).padStart(2, '0') + ' ' + meridiem;
  }

  tick();
  clock.hidden = false;
  // Twenty seconds is often enough that the minute is never visibly stale and
  // rare enough to cost nothing.
  setInterval(tick, 20000);
})();

/* ------------------------------------------------------- the start menu */
(function () {
  'use strict';

  var start = document.querySelector('.start');
  var menu = document.getElementById('startmenu');
  if (!start || !menu) return;

  function setOpen(open) {
    menu.hidden = !open;
    start.setAttribute('aria-expanded', String(open));
  }

  start.addEventListener('click', function (event) {
    event.stopPropagation();
    setOpen(menu.hidden);
  });

  // Anywhere else puts it away — the desktop, the window, a link in the menu.
  document.addEventListener('click', function (event) {
    if (!menu.hidden && !menu.contains(event.target)) setOpen(false);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !menu.hidden) {
      setOpen(false);
      start.focus();
    }
  });
})();

/* ------------------------------------------- windows: raise, hide, restore */
(function () {
  'use strict';

  var windows = document.querySelectorAll('.win[data-win]');
  if (!windows.length) return;

  // The topmost window so far. Clicking any window brings it above the others,
  // which on a desktop with two of them is the whole of window management.
  var top = 10;

  function taskFor(win) {
    return document.querySelector('.task[data-task-for="' + win.getAttribute('data-win') + '"]');
  }

  function raise(win) {
    top += 1;
    win.style.zIndex = String(top);
  }

  function show(win, open) {
    win.hidden = !open;
    var task = taskFor(win);
    if (task) {
      task.classList.toggle('is-active', open);
      task.classList.toggle('is-idle', !open);
    }
    if (open) raise(win);
  }

  Array.prototype.forEach.call(windows, function (win) {
    raise(win);

    win.addEventListener('mousedown', function () {
      raise(win);
    });

    win.addEventListener('click', function (event) {
      var button = event.target.closest('[data-window]');
      if (!button) return;
      var action = button.getAttribute('data-window');
      if (action === 'minimise' || action === 'close') {
        show(win, false);
      } else if (action === 'maximise') {
        var max = win.classList.toggle('is-max');
        button.setAttribute('aria-pressed', String(max));
        // A maximised window has nowhere to be dragged to.
        win.style.left = '';
        win.style.top = '';
      }
    });

    var task = taskFor(win);
    // The taskbar button is the way back in, as it always was.
    if (task) {
      task.addEventListener('click', function () {
        if (win.hidden) show(win, true);
        else raise(win);
      });
    }
  });

  // A shortcut reopens whatever was closed, and so does Escape — neither
  // should leave anyone stranded on an empty wallpaper.
  function reopenAll() {
    Array.prototype.forEach.call(windows, function (win) {
      if (win.hidden) show(win, true);
    });
  }

  var icons = document.querySelector('.icons');
  if (icons) {
    icons.addEventListener('click', function (event) {
      if (event.target.closest('a[href]')) reopenAll();
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') reopenAll();
  });
})();

/* ------------------------------------------------------------ dragging */
(function () {
  'use strict';

  var windows = document.querySelectorAll('.win[data-win]');
  if (!windows.length) return;

  // Dragging is a desktop affordance. On a phone the window is the page, and
  // on a touch screen a drag is how you scroll.
  var fine = window.matchMedia && window.matchMedia('(min-width: 720px) and (pointer: fine)');
  var drag = null;

  Array.prototype.forEach.call(windows, function (win) {
    var bar = win.querySelector('.topbar');
    if (!bar) return;
    bar.addEventListener('mousedown', function (event) {
      if (!fine || !fine.matches) return;
      if (win.classList.contains('is-max')) return;
      // The buttons and the title link have their own jobs.
      if (event.target.closest('button, a')) return;
      var box = win.getBoundingClientRect();
      drag = { win: win, dx: event.clientX - box.left, dy: event.clientY - box.top };
      // A window pinned by its right edge has to be re-pinned by its left one
      // before it can be moved, or it fights the drag.
      win.style.right = 'auto';
      win.style.bottom = 'auto';
      win.style.left = box.left + 'px';
      win.style.top = box.top + 'px';
      event.preventDefault();
    });
  });

  window.addEventListener('mousemove', function (event) {
    if (!drag) return;
    drag.win.style.left = Math.max(0, event.clientX - drag.dx) + 'px';
    drag.win.style.top = Math.max(0, event.clientY - drag.dy) + 'px';
  });

  window.addEventListener('mouseup', function () {
    drag = null;
  });
})();

/* ------------------------------------------------------ the picture's size */
(function () {
  'use strict';

  var img = document.querySelector('.photo-win-body img');
  var size = document.querySelector('.photo-win-size');
  if (!img || !size) return;

  // A viewer of the era told you what you were looking at. The server cannot
  // know the pixels, so the status bar fills in once the file is decoded.
  function fill() {
    if (img.naturalWidth) size.textContent = img.naturalWidth + ' × ' + img.naturalHeight;
  }

  if (img.complete) fill();
  img.addEventListener('load', fill);
})();

/* ------------------------------------------------------------- dialogs */
(function () {
  'use strict';

  var host = document.querySelector('.dialogs');
  if (!host) return;

  var offset = 0;

  function open(template) {
    var box = document.createElement('div');
    box.className = 'dialog';
    box.style.left = 'calc(50% - 195px + ' + offset + 'px)';
    box.style.top = 'calc(36% + ' + offset + 'px)';
    box.style.zIndex = String(8500 + offset);
    offset += 22;

    var info = template.getAttribute('data-kind') === 'info';
    var bar = document.createElement('div');
    bar.className = 'dialog-bar';
    var title = document.createElement('span');
    title.className = 'dialog-title';
    title.textContent = template.getAttribute('data-title') || '';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'win-button is-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    bar.appendChild(title);
    bar.appendChild(close);

    var body = document.createElement('div');
    body.className = 'dialog-body';
    var glyph = document.createElement('div');
    glyph.className = 'dialog-glyph' + (info ? ' is-info' : '');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = info ? 'i' : '!';
    var main = document.createElement('div');
    main.className = 'dialog-main';
    var text = document.createElement('p');
    text.className = 'dialog-text';
    // A template's children live in its DocumentFragment, so its own
    // textContent is always empty — the message is inside `content`.
    text.textContent = template.content.textContent;
    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'dialog-ok';
    ok.textContent = 'OK';
    main.appendChild(text);
    main.appendChild(ok);
    body.appendChild(glyph);
    body.appendChild(main);

    box.appendChild(bar);
    box.appendChild(body);
    // A message is an interruption, so it says so rather than appearing silently
    // to anyone listening to the page instead of looking at it.
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-label', title.textContent);
    host.appendChild(box);
    ok.focus();

    function dismiss() {
      box.remove();
      offset = Math.max(0, offset - 22);
    }

    ok.addEventListener('click', dismiss);
    close.addEventListener('click', dismiss);
    box.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') dismiss();
    });
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-dialog]');
    if (!button) return;
    var template = document.querySelector('[data-dialog-for="' + button.getAttribute('data-dialog') + '"]');
    if (template) open(template);
  });
})();

/* -------------------------------------------------------------- the boot */
(function () {
  'use strict';

  var boot = document.querySelector('.boot');
  if (!boot) return;

  var skip = boot.querySelector('.boot-skip');
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Charming once, tiresome on every click through the site. The machine boots
  // when you arrive and stays booted for the rest of the visit.
  var booted = true;
  try {
    booted = sessionStorage.getItem('td-booted') === '1';
  } catch (error) {
    // A browser with storage blocked simply never sees the splash.
  }

  if (still || booted) return;

  function done() {
    boot.hidden = true;
    try {
      sessionStorage.setItem('td-booted', '1');
    } catch (error) {
      /* nothing to do: the splash just shows again next page */
    }
  }

  // Three screens in turn: the self-test, the logo, the welcome. The memory
  // count on the first is the one part CSS cannot do, so it is counted here.
  var stages = [
    ['post', 1500],
    ['os', 2000],
    ['welcome', 1200]
  ];
  var timers = [];
  var elapsed = 0;
  stages.forEach(function (stage, i) {
    if (i === 0) {
      boot.setAttribute('data-stage', stage[0]);
    } else {
      timers.push(
        setTimeout(function () {
          boot.setAttribute('data-stage', stage[0]);
        }, elapsed)
      );
    }
    elapsed += stage[1];
  });
  timers.push(setTimeout(done, elapsed));

  var memory = boot.querySelector('.boot-mem');
  if (memory) {
    var total = 65536;
    var started = Date.now() + 400;
    var counting = setInterval(function () {
      var at = Math.min(total, Math.max(0, Math.round((Date.now() - started) / 650 * total / 512) * 512));
      memory.textContent = String(at);
      if (at >= total) clearInterval(counting);
    }, 40);
    timers.push(counting);
  }

  function skipNow() {
    timers.forEach(function (t) {
      clearTimeout(t);
      clearInterval(t);
    });
    document.removeEventListener('keydown', onKey);
    done();
  }

  // "Press any key": a bare modifier is not a key.
  function onKey(event) {
    if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].indexOf(event.key) !== -1) return;
    skipNow();
  }

  boot.hidden = false;
  document.addEventListener('keydown', onKey);
  if (skip) {
    skip.focus();
    skip.addEventListener('click', skipNow);
  }
})();
