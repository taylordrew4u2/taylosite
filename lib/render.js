'use strict';

const { defaultSite } = require('./defaults');

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function words(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * "Taylor Drew" -> "TAYLOR<br>DREW", one word per line like the design.
 * Longer headings would eat the whole screen stacked, so they wrap normally
 * at a smaller size instead (see `.display-flow`).
 */
function stackWords(text) {
  const parts = words(text);
  return parts.length <= 2 ? parts.map(esc).join('<br>') : esc(parts.join(' '));
}

function displayClass(text) {
  return words(text).length <= 2 ? '' : ' display-flow';
}

function upcomingShows(site) {
  const today = new Date().toISOString().slice(0, 10);
  return (site.shows || [])
    .filter((s) => s.visible !== false)
    .filter((s) => !s.date || s.date >= today)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function pastShows(site) {
  const today = new Date().toISOString().slice(0, 10);
  return (site.shows || [])
    .filter((s) => s.visible !== false && s.date && s.date < today)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function formatDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return { month: '', day: '', year: '' };
  const d = new Date(`${iso}T12:00:00Z`);
  return {
    month: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
    day: String(d.getUTCDate()).padStart(2, '0'),
    year: String(d.getUTCFullYear())
  };
}

/**
 * A show's ISO start. The time field is written for people ("8:00 PM", "8pm",
 * "20:00"), so it is only used when it reads unambiguously as a clock time —
 * a wrong hour on a date is worse than no hour at all.
 */
function startDateTime(show) {
  const date = String(show.date || '');
  const match = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(String(show.time || ''));
  if (!match) return date;
  let hour = Number(match[1]);
  const minutes = match[2] || '00';
  const meridiem = (match[3] || '').toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  // A bare "8" with no am/pm on a show listing means the evening.
  if (!meridiem && hour < 12 && Number(match[1]) >= 1 && Number(match[1]) <= 11 && !match[2]) hour += 12;
  if (hour > 23) return date;
  return `${date}T${String(hour).padStart(2, '0')}:${minutes}`;
}

function themeCss(themes) {
  const options = themes.options || [];
  const fallback = options.find((o) => o.id === themes.default) || options[0];
  const vars = (t) => `
    --bg: ${t.bg};
    --surface: ${t.surface};
    --text: ${t.text};
    --muted: ${t.muted};
    --accent: ${t.accent};
    --accent-text: ${t.accentText};
    --line: ${t.line};`;
  const blocks = options.map((t) => `[data-theme="${esc(t.id)}"] {${vars(t)} }`).join('\n');
  return `:root {${fallback ? vars(fallback) : ''} }\n${blocks}`;
}

/**
 * The menu, plus the pages a saved menu predates.
 *
 * The nav is content: it lives in the site document, so a menu saved before a
 * page existed has no idea about it — /reels was reachable but unlinked, which
 * to a visitor is the same as missing. Rather than making someone re-open the
 * admin panel to add a link to a page the site already has, a page that is
 * missing from the menu entirely adds itself to the end.
 *
 * "Entirely" is the important word: the check is for any entry pointing at the
 * page, visible or not. So hiding it is still possible — add the item in
 * Navigation and untick it — and a deliberate removal is expressed by keeping
 * a hidden entry rather than by having none.
 */
const IMPLIED_NAV = [
  { id: 'nav-shows', label: 'Shows', href: '/shows' },
  { id: 'nav-reels', label: 'Reels', href: '/reels' },
  { id: 'nav-play', label: 'Play', href: '/play' },
  { id: 'nav-contact', label: 'Contact', href: '/contact' }
];

function navItems(site) {
  const items = (site.nav || []).slice();
  const has = (href) => items.some((item) => String(item.href || '').replace(/\/+$/, '') === href);
  for (const implied of IMPLIED_NAV) {
    if (!has(implied.href)) items.push({ ...implied, visible: true });
  }
  return items;
}

function renderNav(site, current) {
  return navItems(site)
    .filter((item) => item.visible !== false)
    .map((item) => {
      const active = item.href === current;
      return `<a class="nav-link${active ? ' is-active' : ''}" href="${esc(item.href)}"${active ? ' aria-current="page"' : ''}>${esc(item.label)}</a>`;
    })
    .join('');
}

/*
 * The desktop.
 *
 * The site is one window on a desktop: the page is the document inside it, the
 * menu is the window's sidebar, and the footer is its status bar. None of the
 * chrome is content — every word on the pages still comes from the admin panel
 * — so the parts that only make sense with JavaScript (the start menu, the
 * clock, the dialogs, the boot splash) render inert or hidden, and the site
 * reads exactly as it did with scripting off.
 */

/*
 * Desktop icons, drawn the way this machine drew them: 32 pixels square, shaded
 * with a gradient apiece, outlined in a darker tint of their own colour rather
 * than in black, and set down with a soft shadow under them. Rounder and
 * warmer than the hard sixteen-colour art of the decade before — which is the
 * difference between this desktop and the one before it.
 */
const ICON_ART = {
  // My Computer: a CRT in warm silver, its screen lit the blue it booted to.
  monitor: `<defs>
      <linearGradient id="a-mon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f8fa"/><stop offset="1" stop-color="#93a0b0"/></linearGradient>
      <linearGradient id="b-mon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#66b3ea"/><stop offset="1" stop-color="#0f4f8c"/></linearGradient>
    </defs>
    <path d="M10 23h12l2.5 5h-17z" fill="url(#a-mon)" stroke="#5a6674"/>
    <rect x="6.5" y="27.5" width="19" height="3" rx="1.5" fill="url(#a-mon)" stroke="#5a6674"/>
    <rect x="1.5" y="3.5" width="29" height="20" rx="2.5" fill="url(#a-mon)" stroke="#5a6674"/>
    <rect x="4" y="6" width="24" height="15" rx="1.5" fill="url(#b-mon)" stroke="#31465c"/>
    <path d="M4.5 6.5h23l-11 8h-12z" fill="#fff" opacity=".2"/>`,

  // A text file, with the turned corner that always meant "document".
  page: `<defs>
      <linearGradient id="a-page" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#dde5ef"/></linearGradient>
    </defs>
    <path d="M7.5 2.5h11l6 6v21h-17z" fill="url(#a-page)" stroke="#8494a6"/>
    <path d="M18.5 2.5l6 6h-6z" fill="#c6d2e0" stroke="#8494a6"/>
    <g fill="#4f7fbf">
      <rect x="10" y="13" width="11" height="1.6" rx=".8"/>
      <rect x="10" y="17" width="11" height="1.6" rx=".8"/>
      <rect x="10" y="21" width="11" height="1.6" rx=".8"/>
      <rect x="10" y="25" width="7" height="1.6" rx=".8"/>
    </g>`,

  // A strip of film for the clips.
  film: `<defs>
      <linearGradient id="a-film" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#565660"/><stop offset="1" stop-color="#1c1c22"/></linearGradient>
      <linearGradient id="b-film" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cdd6e0"/><stop offset="1" stop-color="#8f9bab"/></linearGradient>
    </defs>
    <rect x="1.5" y="5.5" width="29" height="21" rx="2" fill="url(#a-film)" stroke="#14141a"/>
    <g fill="#f2f5f8">
      <rect x="3.5" y="7.5" width="3.4" height="3" rx=".7"/>
      <rect x="9" y="7.5" width="3.4" height="3" rx=".7"/>
      <rect x="14.4" y="7.5" width="3.4" height="3" rx=".7"/>
      <rect x="19.8" y="7.5" width="3.4" height="3" rx=".7"/>
      <rect x="25.2" y="7.5" width="3.4" height="3" rx=".7"/>
      <rect x="3.5" y="21.5" width="3.4" height="3" rx=".7"/>
      <rect x="9" y="21.5" width="3.4" height="3" rx=".7"/>
      <rect x="14.4" y="21.5" width="3.4" height="3" rx=".7"/>
      <rect x="19.8" y="21.5" width="3.4" height="3" rx=".7"/>
      <rect x="25.2" y="21.5" width="3.4" height="3" rx=".7"/>
    </g>
    <rect x="3.5" y="12.5" width="25" height="7" rx="1" fill="url(#b-film)" stroke="#5c6673"/>`,

  // The manila folder, open, with the tab behind it.
  folder: `<defs>
      <linearGradient id="a-fold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd67e"/><stop offset="1" stop-color="#e2a134"/></linearGradient>
      <linearGradient id="b-fold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffeebb"/><stop offset="1" stop-color="#f3bb55"/></linearGradient>
    </defs>
    <path d="M1.5 7.5h9.5l2.5 3h17v6h-29z" fill="url(#a-fold)" stroke="#a5741d"/>
    <path d="M1.5 12.5h29v12a2 2 0 0 1-2 2h-25a2 2 0 0 1-2-2z" fill="url(#b-fold)" stroke="#a5741d"/>`,

  // A joystick, which is what a game looked like before it looked like a pad.
  joystick: `<defs>
      <linearGradient id="a-joy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f4f7"/><stop offset="1" stop-color="#8b97a5"/></linearGradient>
      <radialGradient id="b-joy" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ff8b8b"/><stop offset="1" stop-color="#b81616"/></radialGradient>
    </defs>
    <rect x="14.2" y="8" width="3.6" height="13" rx="1.8" fill="#6d7782" stroke="#4a545e"/>
    <rect x="3.5" y="19.5" width="25" height="9" rx="2.5" fill="url(#a-joy)" stroke="#5b6672"/>
    <circle cx="22.5" cy="24" r="2.4" fill="url(#b-joy)" stroke="#8d1616"/>
    <circle cx="8.5" cy="24" r="2.4" fill="#b7bf3f" stroke="#6d7320"/>
    <circle cx="16" cy="6.5" r="5" fill="url(#b-joy)" stroke="#8d1616"/>
    <circle cx="14.2" cy="4.8" r="1.5" fill="#fff" opacity=".55"/>`,

  // Mail, sealed.
  envelope: `<defs>
      <linearGradient id="a-env" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#d9e2ee"/></linearGradient>
    </defs>
    <rect x="1.5" y="7.5" width="29" height="18" rx="2" fill="url(#a-env)" stroke="#7d8da1"/>
    <path d="M2 8h28L16 18.5z" fill="#eef3f9" stroke="#7d8da1"/>
    <path d="M2 25l10-8M30 25l-10-8" fill="none" stroke="#9aa9bb"/>`,

  // A cog, the way every system file that would not open was drawn.
  gear: `<defs>
      <linearGradient id="a-gear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef2f7"/><stop offset="1" stop-color="#8794a4"/></linearGradient>
      <linearGradient id="b-gear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d9aaa"/><stop offset="1" stop-color="#5d6a7a"/></linearGradient>
    </defs>
    <g fill="url(#a-gear)" stroke="#5d6a78" stroke-linejoin="round">
      <rect x="13" y="2.5" width="6" height="27" rx="1.5"/>
      <rect x="2.5" y="13" width="27" height="6" rx="1.5"/>
      <g transform="rotate(45 16 16)"><rect x="13" y="2.5" width="6" height="27" rx="1.5"/><rect x="2.5" y="13" width="27" height="6" rx="1.5"/></g>
      <circle cx="16" cy="16" r="9.5"/>
    </g>
    <circle cx="16" cy="16" r="3.6" fill="url(#b-gear)" stroke="#4a5666"/>`
};

/* The badge that marked a shortcut, not the thing: a white tile and an arrow
   turning up out of it. */
const SHORTCUT_BADGE = `<rect x="0.5" y="21.5" width="10" height="10" rx="1.5" fill="#fff" stroke="#8a94a2"/>
  <path d="M3.5 29.5V27a2.5 2.5 0 0 1 2.5-2.5h2" fill="none" stroke="#17356b" stroke-width="1.6"/>
  <path d="M6.6 22.1l3.2 2.4-3.2 2.4z" fill="#17356b"/>`;

function iconArt(name, { shortcut = false } = {}) {
  const art = ICON_ART[name] || ICON_ART.folder;
  return `<svg class="icon-art" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">${art}${
    shortcut ? SHORTCUT_BADGE : ''
  }</svg>`;
}

/** What a page is called in the title bar, and where it "lives" on the C: drive. */
const DESKTOP_PAGES = {
  '/': { word: 'home', path: 'C:\\TAYLOR\\HOME.HTM', art: 'monitor' },
  '/about': { word: 'notepad', path: 'C:\\TAYLOR\\ABOUT.TXT', art: 'page' },
  '/shows': { word: 'show calendar', path: 'C:\\TAYLOR\\SHOWS', art: 'folder' },
  '/reels': { word: 'media player', path: 'C:\\TAYLOR\\CLIPS', art: 'film' },
  '/links': { word: 'my favorites', path: 'C:\\TAYLOR\\LINKS', art: 'folder' },
  '/play': { word: 'PLAY.EXE', path: 'C:\\TAYLOR\\PLAY.EXE', art: 'joystick' },
  '/contact': { word: 'new message', path: 'C:\\TAYLOR\\MAIL', art: 'envelope' }
};

/** A page the menu has but this map does not still gets a plausible path. */
function desktopPage(href) {
  const known = DESKTOP_PAGES[href];
  if (known) return known;
  const slug = String(href || '')
    .replace(/[^a-z0-9]+/gi, '')
    .toUpperCase()
    .slice(0, 8);
  return { word: slug.toLowerCase() || 'window', path: `C:\\TAYLOR\\${slug || 'WINDOW'}`, art: 'folder' };
}

/** The window's own name: the site's, then the document's. */
function windowTitle(site, current) {
  const name = site.brand.logoText || site.brand.name;
  const word = desktopPage(current).word;
  return `${name} \u2014 ${word}`;
}

/*
 * Two shortcuts that open nothing. They are the desktop's joke, and the only
 * pieces of chrome that say anything in a voice of their own — everything else
 * repeats what the admin panel already holds.
 */
const JOKE_ICONS = [
  {
    id: 'bad-sets',
    label: 'Bad Sets',
    art: 'folder',
    title: 'Access denied',
    body: 'BAD SETS is empty. Every set was perfect. Do not investigate further.',
    kind: 'stop'
  },
  {
    id: 'cringe32',
    label: 'CRINGE32',
    art: 'gear',
    title: 'CRINGE32 \u2014 error',
    body: 'Error 0x00TAYLOR: this folder is protected. Contact the administrator (her).',
    kind: 'stop'
  }
];

function renderIcons(site, current) {
  const shortcuts = navItems(site)
    .filter((item) => item.visible !== false)
    .map((item) => {
      const page = desktopPage(item.href);
      // A link to a page is a shortcut to it, so it gets the badge.
      return `<li><a class="icon" href="${esc(item.href)}"${item.href === current ? ' aria-current="page"' : ''}>
        ${iconArt(page.art, { shortcut: true })}
        <span class="icon-label">${esc(item.label)}</span>
      </a></li>`;
    })
    .join('');
  const jokes = JOKE_ICONS.map(
    (j) => `<li><button class="icon" type="button" data-dialog="${esc(j.id)}">
      ${iconArt(j.art)}
      <span class="icon-label">${esc(j.label)}</span>
    </button></li>`
  ).join('');
  return `<ul class="icons" aria-label="Desktop shortcuts">${shortcuts}${jokes}</ul>`;
}

/**
 * The title bar. It keeps the `topbar` class the rest of the site knows it by,
 * and its three buttons do what the window buttons of the era did — which is
 * why they are buttons and the ones in the corner of a mockup are not.
 */
function renderHeader(site, current) {
  const title = windowTitle(site, current);
  return `
  <header class="topbar">
    <a class="logo" href="/" title="${esc(title)}">${esc(title)}</a>
    <div class="win-buttons">
      <button class="win-button" type="button" data-window="minimise" aria-label="Minimise">_</button>
      <button class="win-button" type="button" data-window="maximise" aria-label="Maximise" aria-pressed="false">\u25a1</button>
      <button class="win-button is-close" type="button" data-window="close" aria-label="Close">\u00d7</button>
    </div>
  </header>`;
}

/** The window's sidebar: the menu, where a file tree would have been. */
function renderSidebar(site, current) {
  const place = site.brand.location ? esc(site.brand.location) : '';
  return `
  <div class="sidebar">
    <p class="sidebar-label">navigate</p>
    <nav class="nav" aria-label="Primary">${renderNav(site, current)}</nav>
    ${place ? `<p class="sidebar-foot">${place}</p>` : ''}
  </div>`;
}

/** The taskbar, the start menu it opens, and the splash that covers them. */
/** "/uploads/taylor-drew.jpg?v=2" -> "taylor-drew.jpg". */
function photoFileName(url) {
  const path = String(url || '').split(/[?#]/)[0];
  const last = path.split('/').filter(Boolean).pop() || '';
  // A data: URL or a bare directory has no name worth showing.
  return /^[\w.\-%]+\.\w{2,5}$/.test(last) ? decodeURIComponent(last) : 'photo.jpg';
}

/**
 * The hero photo, opened.
 *
 * On a desktop a picture is not part of a page — it is a file, and opening it
 * gets you a second window. So the home page's photo leaves the document and
 * sits on the wallpaper in a viewer of its own, with its own title bar, its own
 * taskbar button and the filename in the status bar. It is the same `<img>`
 * with the same alt text in the same document, so nothing is lost to a crawler
 * or a screen reader; it has just been put where the era would have put it.
 *
 * Only on the home page, and only when there is a photo — an empty viewer
 * window would be a worse empty state than the one the hero already has.
 */
function renderPhotoWindow(site, current) {
  if (current !== '/' || !site.home.photo) return '';
  const name = photoFileName(site.home.photo);
  return `
  <div class="win photo-win" id="photo-win" data-win="photo">
    <header class="topbar">
      <span class="logo" title="${esc(name)}">${esc(name)} — preview</span>
      <div class="win-buttons">
        <button class="win-button" type="button" data-window="minimise" aria-label="Minimise">_</button>
        <button class="win-button is-close" type="button" data-window="close" aria-label="Close">×</button>
      </div>
    </header>
    <div class="photo-win-body">
      <img class="hero-photo" src="${esc(site.home.photo)}" alt="${esc(site.home.photoAlt)}" fetchpriority="high" decoding="async">
    </div>
    <footer class="footer photo-win-status">
      <span class="footer-path">${esc(name)}</span>
      <span class="photo-win-size"></span>
    </footer>
  </div>`;
}

/** An original early-2000s helper whose answers remain ordinary, crawlable links. */
function renderAssistant(site, current) {
  if (current !== '/') return '';
  const bio = ((site.about && site.about.body) || []).find((p) => String(p || '').trim()) || site.seo.description;
  const status = [site.brand.location || 'NYC', 'probably listening'].filter(Boolean).join(' · ');
  return `
  <aside class="win assistant-win" id="assistant-win" data-win="assistant" aria-label="T.A.Y.L.O.R. Assistant">
    <header class="topbar">
      <span class="logo">T.A.Y.L.O.R. Assistant</span>
      <div class="win-buttons">
        <button class="win-button" type="button" data-window="minimise" aria-label="Minimise assistant">_</button>
        <button class="win-button is-close" type="button" data-window="close" aria-label="Close assistant">×</button>
      </div>
    </header>
    <div class="assistant-body">
      <div class="assistant-character" aria-hidden="true">
        <span class="assistant-antenna"></span>
        <span class="assistant-screen"><i class="assistant-eye assistant-eye-left"></i><i class="assistant-eye assistant-eye-right"></i><i class="assistant-mouth"></i></span>
        <span class="assistant-speaker"><i></i><i></i><i></i><i></i></span>
        <span class="assistant-foot"></span>
      </div>
      <div class="assistant-main">
        <p class="assistant-hello">Hi, Taylor’s visitor.</p>
        <p class="assistant-prompt">I know too much. What do you need?</p>
        <nav class="assistant-actions" aria-label="Ask T.A.Y.L.O.R. Assistant">
          <a class="assistant-action" href="/about"><span>Who is Taylor?</span><small>${esc(bio)}</small></a>
          <a class="assistant-action" href="/links#shows"><span>Upcoming shows</span><small>Open the calendar for the latest announced dates and tickets.</small></a>
          <a class="assistant-action" href="/reels"><span>Watch clips</span><small>Open the media player.</small></a>
          <a class="assistant-action" href="/contact"><span>Book Taylor</span><small>Compose a booking message.</small></a>
        </nav>
      </div>
    </div>
    <footer class="assistant-status"><span aria-hidden="true">●</span> online · ${esc(status)}</footer>
  </aside>`;
}

/**
 * The boot.
 *
 * Turning the machine on was three screens, and this is all three, drawn as
 * close to the originals as a stylesheet gets: the self-test in light grey on
 * black with the memory counting up and the drives being found, the black
 * screen with the waving flag and the blue blocks marching under the name,
 * then the blue welcome screen — your name and picture while it loads your
 * settings, then just the word. It is hidden until desktop.js shows it, once a
 * visit, and everything on it is decoration: the crawler and the screen
 * reader get the page underneath.
 */

/** The flag and the wordmark, at the two sizes they are set in. */
function bootLogo(name, key) {
  const id = (c) => `bf-${key}-${c}`;
  return `
      <span class="boot-logo">
        <svg class="boot-flag" viewBox="0 0 66 54" aria-hidden="true">
          <defs>
            <linearGradient id="${id('r')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a6a"/><stop offset=".55" stop-color="#ee4a2a"/><stop offset="1" stop-color="#c81e12"/></linearGradient>
            <linearGradient id="${id('g')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9f37e"/><stop offset=".55" stop-color="#6cc330"/><stop offset="1" stop-color="#2f8d18"/></linearGradient>
            <linearGradient id="${id('b')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8ec6ff"/><stop offset=".55" stop-color="#2f6fe0"/><stop offset="1" stop-color="#1443b4"/></linearGradient>
            <linearGradient id="${id('y')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0a0"/><stop offset=".55" stop-color="#f9c22b"/><stop offset="1" stop-color="#e08a00"/></linearGradient>
            <linearGradient id="${id('s')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
          </defs>
          <g class="boot-flag-tail" fill="#fff">
            <path d="M0 27 C6 22 10 22 14 24 L14 32 C10 30 6 30 0 35 Z"/>
          </g>
          <path d="M4 11 C14 3 24 3 32 8 L32 26 C24 21 14 21 4 29 Z" fill="url(#${id('r')})"/>
          <path d="M36 7 C46 12 56 4 64 1 L64 19 C56 22 46 30 36 25 Z" fill="url(#${id('g')})"/>
          <path d="M4 33 C14 25 24 25 32 30 L32 48 C24 43 14 43 4 51 Z" fill="url(#${id('b')})"/>
          <path d="M36 29 C46 34 56 26 64 23 L64 41 C56 44 46 52 36 47 Z" fill="url(#${id('y')})"/>
          <path d="M4 11 C14 3 24 3 32 8 L32 17 C24 12 14 12 4 20 Z M36 7 C46 12 56 4 64 1 L64 10 C56 13 46 21 36 16 Z M4 33 C14 25 24 25 32 30 L32 39 C24 34 14 34 4 42 Z M36 29 C46 34 56 26 64 23 L64 32 C56 35 46 43 36 38 Z" fill="url(#${id('s')})"/>
        </svg>
        <span class="boot-wordmark">
          <span class="boot-wm-small">${esc(name)}<sup>&reg;</sup></span>
          <span class="boot-wm-big">Comedy<sup>os</sup></span>
          <span class="boot-wm-edition">Mom&#39;s Computer Edition</span>
        </span>
      </span>`;
}

function renderBoot(site, name) {
  const post = [
    'Modular BIOS v4.51PG, An Energy Star Ally',
    'Copyright (C) 1984-2001, Comedy Software, Inc.',
    '',
    'TAYLOR DREW ACPI BIOS Revision 1012 (Still Beta)',
    '',
    'Intel Pentium II 350MHz Processor (Feels Faster)',
    'Memory Test :  <span class="boot-mem">0</span>K OK',
    'Memory of 8th Grade :  Repressed',
    '',
    'Plug and Play BIOS Extension v1.0A',
    'Detecting HDD Primary Master  ... COMEDY WD84AA (4.3GB, Mostly Crowd Work)',
    'Detecting HDD Primary Slave   ... None',
    'Detecting HDD Secondary Master... CD-ROM (Now That&#39;s What I Call Music! 7)',
    'Detecting HDD Secondary Slave ... None',
    'Detecting Jokes               ... 1024 Found, 3 Good',
    'Detecting Self-Esteem         ... Not Present',
    'Detecting Mouse               ... Ball Needs Cleaning',
    'Detecting Dial-Up             ... Mom Is On The Phone',
    '',
    'Keyboard error or no keyboard present',
    'Press F1 to continue, DEL to enter SETUP'
  ]
    .map((line, i) => `<span class="boot-line" style="--i:${i}">${line || '&nbsp;'}</span>`)
    .join('');
  const users = [
    ['you', esc(name), 'Loading your personal problems...', true],
    ['mom', 'Mom', 'Password protected. It&#39;s the dog&#39;s name.'],
    ['dad', 'Dad', '47 unread e-mail messages'],
    ['grandma', 'Grandma', 'Solitaire is running']
  ]
    .map(
      ([pic, who, note, lit]) =>
        `<div class="boot-user${lit ? ' is-lit' : ''}"><span class="boot-avatar"><i data-pic="${pic}"></i></span><span class="boot-user-text"><b>${who}</b><small>${note}</small></span></div>`
    )
    .join('');
  return `
  <div class="boot" hidden data-stage="post">
    <div class="boot-post" aria-hidden="true">
      <pre class="boot-post-text">${post}</pre>
      <span class="boot-estar"><i></i><b>energy</b><small>epa pollution preventer</small></span>
      <p class="boot-post-foot"><span>Press DEL to enter SETUP, ESC to enter therapy</span><span>12/25/99-i440BX-DADS-OLD-PC-2A69KA0IC-00</span></p>
    </div>
    <div class="boot-os" aria-hidden="true">
      ${bootLogo(name, 'os')}
      <div class="boot-bar"><span></span></div>
      <p class="boot-os-copy">Copyright &copy; ${esc(name)}. Do not steal bits.</p>
      <p class="boot-os-brand">${esc(name)}</p>
    </div>
    <div class="boot-welcome" aria-hidden="true">
      <div class="boot-welcome-mid">
        <div class="boot-welcome-left">
          ${bootLogo(name, 'wel')}
          <p class="boot-welcome-hint">To begin, click your user name. Not Dad&#39;s.</p>
        </div>
        <div class="boot-welcome-right">
          <div class="boot-users">${users}</div>
          <p class="boot-welcome-word">welcome</p>
        </div>
      </div>
      <div class="boot-welcome-foot">
        <span class="boot-poweroff"><i></i>Turn off computer (properly this time)</span>
        <span class="boot-welcome-note">After you log on, do not download anything.<br>Mom will know. Mom always knows.</span>
      </div>
    </div>
    <button class="boot-skip" type="button">press any key to skip</button>
  </div>`;
}

function renderShell(site, current) {
  const name = site.brand.logoText || site.brand.name;
  const dialogs = JOKE_ICONS.map(
    (j) =>
      `<template data-dialog-for="${esc(j.id)}" data-title="${esc(j.title)}" data-kind="${esc(j.kind)}">${esc(j.body)}</template>`
  ).join('');
  return `
  <div class="startmenu" id="startmenu" hidden>
    <p class="startmenu-head">${esc(name)}</p>
    <nav class="startmenu-list" aria-label="Start menu">${renderNav(site, current)}</nav>
  </div>
  <div class="taskbar">
    <button class="start" type="button" aria-expanded="false" aria-controls="startmenu"><span class="start-mark" aria-hidden="true"></span>start</button>
    <div class="tasks">
      <button class="task is-active" type="button" data-task-for="main">${esc(windowTitle(site, current))}</button>
      ${current === '/' ? '<button class="task is-active" type="button" data-task-for="assistant">T.A.Y.L.O.R. Assistant</button>' : ''}
      ${
        current === '/' && site.home.photo
          ? `<button class="task is-active" type="button" data-task-for="photo">${esc(photoFileName(site.home.photo))}</button>`
          : ''
      }
    </div>
    <div class="tray"><span class="clock" hidden></span></div>
  </div>
  <div class="dialogs" role="region" aria-label="Messages"></div>
  ${dialogs}
  ${renderBoot(site, name)}`;
}

/** "Brooklyn, NY" -> a PostalAddress search engines can actually read. */
function postalAddress(city, extra = {}) {
  const text = String(city || '').trim();
  const rest = {
    ...(extra.street ? { streetAddress: extra.street } : {}),
    ...(extra.postalCode ? { postalCode: extra.postalCode } : {}),
    ...(extra.country ? { addressCountry: extra.country } : {})
  };
  if (!text) return Object.keys(rest).length ? { '@type': 'PostalAddress', ...rest } : null;
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { '@type': 'PostalAddress', ...rest, addressLocality: text };
  return {
    '@type': 'PostalAddress',
    ...rest,
    addressLocality: parts.slice(0, -1).join(', '),
    addressRegion: parts[parts.length - 1]
  };
}

/**
 * Profiles that identify the same person somewhere else. These become `sameAs`,
 * which is how a knowledge graph decides that this Taylor Drew and the one on
 * IMDb are one person and not two — the strongest disambiguation signal a small
 * site has, and the reason IMDb and Wikipedia matter here as much as Instagram.
 */
const IDENTITY_HOSTS =
  /(?:^|\.)(?:instagram|tiktok|youtube|x|twitter|facebook|threads|bsky|linkedin|spotify|patreon|substack|imdb|backstage|vimeo|soundcloud|bandcamp|letterboxd|twitch|tumblr|discogs|wikipedia|wikidata|podcasts\.apple|music\.apple)\.(?:com|app|social|me|tv|org|net|fm)$/i;

/**
 * A profile URL as the profile itself, without whatever the address bar was
 * carrying when it was copied. IMDb hands out links ending `?ref_=tt_ov_1_1`;
 * matched against the canonical URL a knowledge graph already holds, that is a
 * different string, and a weaker claim that the two are the same person.
 */
function canonicalProfile(url) {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch (_) {
    return url;
  }
}

function identityLinks(site) {
  const seen = new Set();
  return (site.links.items || [])
    .filter((l) => l.visible !== false && /^https?:/i.test(l.url))
    .map((l) => {
      try {
        return { url: canonicalProfile(l.url), host: new URL(l.url).hostname };
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .filter((l) => IDENTITY_HOSTS.test(l.host))
    .filter((l) => {
      if (seen.has(l.url)) return false;
      seen.add(l.url);
      return true;
    });
}

/**
 * The handle she is actually searched by. Schema.org keeps `alternateName` for
 * exactly this: the other string that means this person.
 */
function socialHandle(site) {
  const match = identityLinks(site).find((l) => /(?:^|\.)instagram\.com$/i.test(l.host));
  if (!match) return '';
  const handle = new URL(match.url).pathname.split('/').filter(Boolean)[0];
  return handle && /^[A-Za-z0-9_.]{1,30}$/.test(handle) ? `@${handle}` : '';
}

/** The @handle from a linked X/Twitter profile, for the Twitter card. */
function twitterHandle(site) {
  const match = identityLinks(site).find((l) => /(?:^|\.)(?:x|twitter)\.com$/i.test(l.host));
  if (!match) return '';
  const handle = new URL(match.url).pathname.split('/').filter(Boolean)[0];
  return handle && /^[A-Za-z0-9_]{1,15}$/.test(handle) ? `@${handle}` : '';
}

/**
 * Structured data, as one linked graph rather than loose objects — so a crawler
 * can see that this page, this site and this person are the same subject, and
 * that the shows are hers. `<` is escaped to keep the block un-breakable.
 */
function jsonLd(site, { origin, canonical, title, current }) {
  const sameAs = identityLinks(site).map((l) => l.url);

  // The Wikidata item, if she has one, is the strongest entry in this list: it
  // is the record the knowledge graphs are built from, so naming it turns a
  // page that describes her into a page that resolves to a known entity.
  const wikidata = String((site.seo && site.seo.wikidata) || '').trim();
  if (wikidata) sameAs.unshift(`https://www.wikidata.org/wiki/${wikidata}`);
  const websiteId = `${origin}/#website`;
  const personId = `${origin}/#person`;
  const pageId = `${canonical}#webpage`;
  const imageId = `${origin}/#primaryimage`;
  const listId = `${origin}/links#list`;

  // Named nodes rather than bare URLs, so a photo can be pointed at from the
  // person and from each page instead of being repeated as a string — and so
  // image search has a caption and an owner for each one rather than a filename.
  const imageNode = (id, path, caption) =>
    path
      ? {
          '@type': 'ImageObject',
          '@id': id,
          url: new URL(path, origin).href,
          contentUrl: new URL(path, origin).href,
          caption: caption || site.brand.name
        }
      : null;

  const primaryImage = imageNode(imageId, site.home.photo, site.home.photoAlt);
  const aboutImage = imageNode(`${origin}/#aboutimage`, site.about.photo, site.about.photoAlt);
  const shareImage =
    site.seo.ogImage && site.seo.ogImage !== site.home.photo && site.seo.ogImage !== site.about.photo
      ? imageNode(`${origin}/#shareimage`, site.seo.ogImage, site.seo.ogImageAlt)
      : null;

  // Deduplicated: two fields pointing at one upload is one photograph.
  const images = [primaryImage, aboutImage, shareImage].filter(Boolean);
  const seen = new Set();
  const uniqueImages = images.filter((img) => (seen.has(img.url) ? false : seen.add(img.url)));
  // One page, one representative image. Flagging all three said "this is the
  // picture of this page" three times over, which answers the question by not
  // answering it — so the flag goes on the photo actually on the page being
  // rendered, and nowhere else.
  const pageImage = { '/about': aboutImage }[current] || primaryImage || aboutImage;
  if (pageImage) pageImage.representativeOfPage = true;

  const website = {
    '@type': 'WebSite',
    '@id': websiteId,
    url: `${origin}/`,
    name: site.brand.name,
    inLanguage: 'en',
    publisher: { '@id': personId }
  };

  const person = {
    '@type': 'Person',
    '@id': personId,
    name: site.brand.name,
    jobTitle: site.brand.accentLabel || 'Stand-up comedian',
    description: site.seo.description,
    url: `${origin}/`,
    // The about page is where this person is described — it is the ProfilePage,
    // and saying so is what stops a crawler treating three pages as three
    // different subjects.
    mainEntityOfPage: { '@id': `${origin}/about#webpage` },
    ...(site.brand.email
      ? {
          email: `mailto:${site.brand.email}`,
          contactPoint: {
            '@type': 'ContactPoint',
            contactType: 'Booking',
            email: site.brand.email,
            ...(site.brand.location ? { areaServed: site.brand.location } : {})
          }
        }
      : {}),
    ...(site.brand.location
      ? { homeLocation: { '@type': 'Place', name: site.brand.location }, address: postalAddress(site.brand.location) }
      : {}),
    ...(uniqueImages.length
      ? { image: uniqueImages.length === 1 ? { '@id': uniqueImages[0]['@id'] } : uniqueImages.map((i) => ({ '@id': i['@id'] })) }
      : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(wikidata
      ? {
          identifier: {
            '@type': 'PropertyValue',
            propertyID: 'Wikidata',
            value: wikidata,
            url: `https://www.wikidata.org/wiki/${wikidata}`
          }
        }
      : {})
  };

  // The bio says far more about her than the meta description, and it is the
  // paragraph an answer engine will quote if it has it.
  const bio = ((site.about && site.about.body) || []).find((p) => String(p || '').trim());
  if (bio) person.description = bio;

  // "TAYLOR DREW" is the same name; a genuinely different logo text is not.
  // The handle is always a different string that means the same person.
  const names = [];
  const logoText = String(site.brand.logoText || '').trim();
  if (logoText && logoText.toLowerCase() !== String(site.brand.name || '').toLowerCase()) {
    names.push(logoText);
  }
  const handle = socialHandle(site);
  if (handle) names.push(handle);
  if (names.length) person.alternateName = names.length === 1 ? names[0] : names;

  // The one line that answers "which Taylor Drew is this?" — schema.org keeps a
  // property for precisely that question, and it is the question an answer
  // engine has to settle before it will name anyone.
  const what = String(site.brand.accentLabel || '').trim();
  const where = String(site.brand.location || '').trim();
  if (what) person.disambiguatingDescription = where ? `${what} based in ${where}` : what;

  // "female comedians in New York" is a question about a property, and a
  // pronoun buried in a paragraph is not one. Stated, it can be matched.
  const gender = String(site.brand.gender || '').trim();
  if (gender) person.gender = gender;

  // Awards are a plain Person property. Everything else she worked on is
  // described as the work it is, pointing back at her — which is how schema.org
  // expresses a credit, since a person has no "was in" property of their own.
  const credits = visibleCredits(site);
  const awards = credits.filter((c) => c.award).map((c) => [c.title, c.detail].filter(Boolean).join(' — '));
  if (awards.length) person.award = awards;

  const works = credits
    .filter((c) => !c.award)
    .map((c, i) => ({
      '@type': 'CreativeWork',
      '@id': `${origin}/#credit-${encodeURIComponent(c.id)}`,
      name: c.title,
      ...(c.detail ? { description: c.detail } : {}),
      ...(/^\d{4}$/.test(c.year || '') ? { datePublished: c.year } : {}),
      ...(c.url ? { url: c.url } : {}),
      contributor: { '@id': personId }
    }));

  // What other people have said about her, attributed. A press quote sitting in
  // a blockquote is decoration to a crawler; as a Quotation with a citation it
  // is evidence, and evidence is what an answer engine repeats.
  const quotations = ((site.about && site.about.quotes) || [])
    .filter((q) => String(q.text || '').trim())
    .map((q) => ({
      '@type': 'Quotation',
      '@id': `${origin}/#quote-${encodeURIComponent(q.id)}`,
      text: q.text,
      about: { '@id': personId },
      ...(q.source ? { citation: q.source, creator: { '@type': 'Organization', name: q.source } } : {})
    }));
  if (quotations.length) person.subjectOf = quotations.map((q) => ({ '@id': q['@id'] }));

  if (site.brand.accentLabel) {
    person.hasOccupation = {
      '@type': 'Occupation',
      name: site.brand.accentLabel,
      ...(site.brand.location
        ? { occupationLocation: { '@type': 'City', name: site.brand.location } }
        : {})
    };
  }

  // ProfilePage belongs on the about page, not the home page. Google documents
  // "An 'About Me' page" as the valid case and "the main home page … usually
  // contains lots of non-profile info" as an invalid one, and requires the
  // person as its `mainEntity` — which is what the about page already is.
  const pageTypes = { '/': 'WebPage', '/about': 'ProfilePage', '/links': 'CollectionPage', '/reels': 'CollectionPage' };
  const webPage = {
    '@type': pageTypes[current] || 'WebPage',
    '@id': pageId,
    url: canonical,
    name: title,
    description: site.seo.description,
    isPartOf: { '@id': websiteId },
    about: { '@id': personId },
    mainEntity: { '@id': personId },
    inLanguage: 'en',
    // Which parts a voice assistant should read aloud for this page.
    speakable: { '@type': 'SpeakableSpecification', cssSelector: ['h1', '.subhead', '.prose p'] },
    ...(pageImage ? { primaryImageOfPage: { '@id': pageImage['@id'] } } : {}),
    ...(site.meta && site.meta.updatedAt ? { dateModified: site.meta.updatedAt } : {})
  };

  const breadcrumb =
    current && current !== '/'
      ? [
          {
            '@type': 'BreadcrumbList',
            '@id': `${canonical}#breadcrumb`,
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
              { '@type': 'ListItem', position: 2, name: title.split('—')[0].trim(), item: canonical }
            ]
          }
        ]
      : [];
  if (breadcrumb.length) webPage.breadcrumb = { '@id': `${canonical}#breadcrumb` };

  // The questions people actually ask, with her answers. This is the block an
  // answer engine lifts wholesale, so it is a page-level node of its own rather
  // than a property buried on the person.
  const faqs = visibleFaqs(site);
  const faqPage =
    current === '/about' && faqs.length
      ? [
          {
            '@type': 'FAQPage',
            '@id': `${canonical}#faq`,
            url: canonical,
            name: `${site.about.faqLabel || 'Questions'} — ${site.brand.name}`,
            inLanguage: 'en',
            isPartOf: { '@id': websiteId },
            about: { '@id': personId },
            mainEntity: faqs.map((f) => ({
              '@type': 'Question',
              '@id': `${canonical}#question-${encodeURIComponent(f.id)}`,
              name: f.question,
              acceptedAnswer: { '@type': 'Answer', text: f.answer }
            }))
          }
        ]
      : [];
  if (faqPage.length) webPage.hasPart = { '@id': faqPage[0]['@id'] };

  const events = upcomingShows(site)
    .filter((show) => show.date && show.venue)
    .map((show) => {
      const address = postalAddress(show.city, show);
      return {
        '@type': 'Event',
        '@id': `${origin}/#show-${encodeURIComponent(show.id)}`,
        name: `${site.brand.name} at ${show.venue}`,
        // A date alone puts the show at midnight. A door time turns it into the
        // evening it is, which is what a "tonight near me" answer sorts on.
        startDate: startDateTime(show),
        ...(show.note ? { description: show.note } : {}),
        // The flyer is the picture of this event; without one the page's own
        // representative image stands in.
        ...(show.flyer
          ? { image: /^https?:/i.test(show.flyer) ? show.flyer : origin + show.flyer }
          : primaryImage
            ? { image: { '@id': primaryImage['@id'] } }
            : {}),
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: {
          '@type': 'Place',
          name: show.venue,
          ...(address ? { address } : {})
        },
        performer: { '@id': personId },
        ...(show.url
          ? {
              url: show.url,
              offers: {
                '@type': 'Offer',
                url: show.url,
                availability: show.soldOut ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock'
              }
            }
          : {}),
        ...(show.url
          ? {}
          : {
              url: `${origin}/shows`,
              ...(show.soldOut ? { offers: { '@type': 'Offer', availability: 'https://schema.org/SoldOut' } } : {})
            })
      };
    });

  // The links page is a list of destinations. Saying so — with the real URLs
  // rather than the counted /go/ redirects — is what lets an answer engine name
  // where to find her rather than only that a links page exists.
  const linkItems = (site.links.items || [])
    .filter((l) => l.visible !== false && l.label && /^(?:https?:|mailto:)/i.test(l.url || ''))
    .map((l, i) => ({ '@type': 'ListItem', position: i + 1, name: l.label, url: l.url }));

  const itemList =
    current === '/links' && linkItems.length
      ? [
          {
            '@type': 'ItemList',
            '@id': listId,
            name: site.links.title || 'Links',
            numberOfItems: linkItems.length,
            itemListOrder: 'https://schema.org/ItemListOrderAscending',
            itemListElement: linkItems
          }
        ]
      : [];
  if (itemList.length) webPage.mainEntity = { '@id': listId };

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      website,
      person,
      webPage,
      ...uniqueImages,
      ...works,
      ...quotations,
      ...faqPage,
      ...itemList,
      ...breadcrumb,
      ...events
    ]
  };
  return `<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, '\\u003c')}</script>`;
}

function renderFooter(site, current) {
  const right = site.footer.rightHref
    ? `<a class="footer-right" href="${esc(site.footer.rightHref)}">${esc(site.footer.right)}</a>`
    : `<span class="footer-right">${esc(site.footer.right)}</span>`;
  // The window's status bar. The path on the left is the only invented part;
  // everything after it is still the footer the admin panel writes.
  return `
  <footer class="footer">
    <span class="footer-path">${esc(desktopPage(current).path)}</span>
    <span class="footer-left">${esc(site.footer.left)}</span>
    ${site.footer.note ? `<span class="footer-note">${esc(site.footer.note)}</span>` : ''}
    ${right}
    <span class="footer-ready">ready</span>
  </footer>`;
}

/** Share cards render faster when the scraper is told the format up front. */
function imageType(path) {
  const ext = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(String(path || ''));
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' }[
    (ext && ext[1].toLowerCase()) || ''
  ] || '';
}

/** og:type is `profile` on the home page, which has properties of its own. */
function profileMeta(site) {
  const parts = words(site.brand.name);
  if (!parts.length) return '';
  const first = parts[0];
  const last = parts.length > 1 ? parts.slice(1).join(' ') : '';
  const handle = twitterHandle(site).replace(/^@/, '');
  return [
    `<meta property="profile:first_name" content="${esc(first)}">`,
    last ? `<meta property="profile:last_name" content="${esc(last)}">` : '',
    handle ? `<meta property="profile:username" content="${esc(handle)}">` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

function layout(site, { title, description, current, body, bodyClass = '', origin = '', noindex = false }) {
  const theme = (site.themes && site.themes.default) || 'A';
  const active = (site.themes.options || []).find((o) => o.id === theme) || {};
  const accent = active.accent || '#ef4123';
  // Phone browsers tint their chrome with this, so it wants the page background:
  // the accent would put a coloured band above a black header.
  const themeColor = active.bg || accent;
  // A tab icon is 16 pixels across. A full wordmark or a photograph turns to
  // mush at that size, so the tab always gets the initials mark from
  // /favicon.svg, and an uploaded icon takes the large surfaces where its
  // detail survives — the phone home screen, bookmarks, the install prompt.
  const favicon = [
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml" media="(prefers-color-scheme: light)">',
    '<link rel="icon" href="/favicon-dark.svg" type="image/svg+xml" media="(prefers-color-scheme: dark)">',
    site.seo.favicon
      ? `<link rel="apple-touch-icon" href="${esc(site.seo.favicon)}">\n<link rel="icon" href="${esc(
          site.seo.favicon
        )}" sizes="any">`
      : '',
    '<link rel="manifest" href="/site.webmanifest">'
  ]
    .filter(Boolean)
    .join('\n');
  const shareImage = site.seo.ogImage || site.home.photo;
  // The share image is often a logo rather than the hero photo, in which case
  // the hero's alt text describes the wrong picture.
  const shareImageAlt =
    (site.seo.ogImage ? site.seo.ogImageAlt : site.home.photoAlt) ||
    site.home.photoAlt ||
    site.brand.name;
  const absolute = (url) => (url && origin && url.startsWith('/') ? origin + url : url);
  const canonical = origin ? `${origin}${current === '/' ? '/' : current}` : '';
  const twitter = twitterHandle(site);
  return `<!doctype html>
<html lang="en" data-theme="${esc(theme)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="${esc(themeColor)}">
<meta name="author" content="${esc(site.brand.name)}">
${site.seo.googleVerification ? `<meta name="google-site-verification" content="${esc(site.seo.googleVerification)}">\n` : ''}${site.seo.bingVerification ? `<meta name="msvalidate.01" content="${esc(site.seo.bingVerification)}">\n` : ''}<meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:site_name" content="${esc(site.brand.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="${current === '/' ? 'profile' : 'website'}">
<meta property="og:locale" content="en_US">
${current === '/' ? profileMeta(site) : ''}
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
${shareImage ? `<meta property="og:image" content="${esc(absolute(shareImage))}">\n<meta property="og:image:alt" content="${esc(shareImageAlt)}">${imageType(shareImage) ? `\n<meta property="og:image:type" content="${imageType(shareImage)}">` : ''}` : ''}
<meta name="twitter:card" content="${shareImage ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${twitter ? `<meta name="twitter:creator" content="${esc(twitter)}">\n<meta name="twitter:site" content="${esc(twitter)}">` : ''}
${shareImage ? `<meta name="twitter:image" content="${esc(absolute(shareImage))}">` : ''}
${favicon}
<meta name="apple-mobile-web-app-title" content="${esc(site.brand.logoText || site.brand.name)}">
<!-- The plain-text summary answer engines fetch before crawling the pages. -->
<link rel="alternate" type="text/markdown" href="/llms.txt" title="llms.txt">
${identityLinks(site)
  .map((l) => `<link rel="me" href="${esc(l.url)}">`)
  .join('\n')}
<link rel="stylesheet" href="/assets/css/site.css">
${
  // The hero is the largest thing on the home page, so it is what Largest
  // Contentful Paint is timed against — and page speed is a ranking input.
  // Preloading it starts the fetch with the stylesheet instead of after it.
  current === '/' && site.home.photo
    ? `<link rel="preload" as="image" href="${esc(site.home.photo)}" fetchpriority="high">`
    : ''
}
<style>${themeCss(site.themes || {})}</style>
<!-- The desktop skin. It loads last so it can re-point the theme's neutral
     variables; the accent stays whatever the served scheme says. desktop.css
     holds what the admin panel shares with it — the wallpaper and the window
     palette — so neither half of the machine drifts from the other. -->
<link rel="stylesheet" href="/assets/css/desktop.css">
<link rel="stylesheet" href="/assets/css/retro.css">
</head>
<body class="${esc(bodyClass)}">
<a class="skip-link" href="#main">Skip to content</a>
<div class="desk">
<div class="wall" aria-hidden="true"></div>
${renderIcons(site, current)}
<div class="win" id="win" data-win="main">
${renderHeader(site, current)}
<div class="win-body">
${renderSidebar(site, current)}
<div class="win-doc">
<main class="main" id="main" tabindex="-1">
${body}
</main>
${renderFooter(site, current)}
</div>
</div>
</div>
${renderPhotoWindow(site, current)}
${renderAssistant(site, current)}
${renderShell(site, current)}
</div>
${origin ? jsonLd(site, { origin, canonical, title, current }) : ''}
<script src="/assets/js/site.js" defer></script>
<script src="/assets/js/desktop.js" defer></script>
</body>
</html>`;
}

function renderShowRow(show, { compact = false } = {}) {
  const d = formatDate(show.date);
  // The flyer sits beside the full listing; the home page's compact rows stay
  // text-only so the upcoming block keeps its rhythm.
  const flyer =
    !compact && show.flyer
      ? `<a class="show-flyer" href="${esc(show.flyer)}" target="_blank" rel="noopener"><img src="${esc(show.flyer)}" alt="Flyer for ${esc(show.venue || 'this show')}" loading="lazy" decoding="async"></a>`
      : '';
  const thisYear = String(new Date().getUTCFullYear());
  const dateBlock = d.day
    ? `<time class="show-date" datetime="${esc(show.date)}">
        <span class="show-month">${esc(d.month)}</span>
        <span class="show-day">${esc(d.day)}</span>
        ${d.year !== thisYear ? `<span class="show-year">${esc(d.year)}</span>` : ''}
      </time>`
    : '<span class="show-date"><span class="show-month">TBA</span></span>';
  // The venue is already the row's title — the meta line carries city and time.
  const meta = [show.city, show.time].filter(Boolean).map(esc).join(' · ');
  const cta = show.soldOut
    ? '<span class="show-cta is-soldout">Sold out</span>'
    : show.url
      ? `<a class="show-cta" href="${esc(show.url)}" target="_blank" rel="noopener">${esc(show.ctaLabel || 'Tickets')}<span class="sr-only"> for ${esc(show.venue || 'this show')}</span></a>`
      : '';
  return `<li class="show${compact ? ' show-compact' : ''}">
    ${dateBlock}
    ${flyer}
    <span class="show-body">
      <span class="show-venue">${esc(show.venue || 'To be announced')}</span>
      ${meta ? `<span class="show-meta">${meta}</span>` : ''}
      ${show.note ? `<span class="show-note">${esc(show.note)}</span>` : ''}
    </span>
    ${cta}
  </li>`;
}

function renderHome(site, ctx = {}) {
  const home = site.home;
  const shows = upcomingShows(site).slice(0, home.upcoming.maxItems || 3);
  // The photo itself opens in its own window on the desktop (see
  // renderPhotoWindow), so what stays in the hero is the empty state — the one
  // thing that belongs on the page, because it is addressed to whoever is
  // about to go and add a photo.
  const photo = home.photo ? '' : `<span class="photo-placeholder">${esc(home.photoPlaceholder)}</span>`;

  const upcoming = home.upcoming.visible
    ? `<div class="hero-upcoming">
        <h2 class="eyebrow">${esc(home.upcoming.label)}</h2>
        <div class="rule"></div>
        ${
          shows.length
            ? `<ul class="show-list">${shows.map((s) => renderShowRow(s, { compact: true })).join('')}</ul>`
            : `<p class="display display-sm${displayClass(home.upcoming.emptyText)}">${stackWords(home.upcoming.emptyText)}</p>`
        }
        <a href="/shows">${esc(home.upcoming.allShowsLabel || 'All dates')}</a>
      </div>`
    : '';

  const ctas = [home.primaryCta, home.secondaryCta]
    .filter((c) => c && c.visible !== false && c.label)
    .map(
      (c, i) =>
        `<a class="btn ${i === 0 ? 'btn-accent' : 'btn-ghost'}" href="${esc(c.href)}">${esc(c.label)}</a>`
    )
    .join('');

  const body = `
  <section class="hero">
    <div class="hero-main">
      ${home.kicker ? `<p class="eyebrow hero-kicker">${esc(home.kicker)}</p>` : ''}
      <h1 class="display hero-title${displayClass(home.headline)}">${stackWords(home.headline)}</h1>
      <div class="rule rule-accent"></div>
      ${home.subhead ? `<p class="subhead">${esc(home.subhead)}</p>` : ''}
      <div class="cta-row">${ctas}</div>
    </div>
    ${
      photo || upcoming
        ? `<aside class="hero-side">
      ${photo ? `<div class="hero-photo-wrap">${photo}</div>` : ''}
      ${upcoming}
    </aside>`
        : ''
    }
  </section>`;

  return layout(site, {
    title: site.seo.title,
    description: site.seo.description,
    current: '/',
    bodyClass: 'page-home',
    origin: ctx.origin,
    body
  });
}

function visibleCredits(site) {
  return ((site.about && site.about.credits) || []).filter((c) => c.visible !== false && c.title);
}

function visibleFaqs(site) {
  return ((site.about && site.about.faqs) || []).filter((f) => f.visible !== false && f.question && f.answer);
}

function renderCredit(credit) {
  const meta = [credit.detail, credit.year].filter(Boolean).map(esc).join(' · ');
  const title = credit.url
    ? `<a class="credit-title" href="${esc(credit.url)}" target="_blank" rel="noopener">${esc(credit.title)}</a>`
    : `<span class="credit-title">${esc(credit.title)}</span>`;
  return `<li class="credit${credit.award ? ' is-award' : ''}">
    ${title}
    ${meta ? `<span class="credit-meta">${meta}</span>` : ''}
  </li>`;
}

function renderAbout(site, ctx = {}) {
  const about = site.about;
  const paragraphs = (about.body || []).map((p) => `<p>${esc(p)}</p>`).join('');
  const facts = (about.facts || []).filter((f) => f.label || f.value);
  const quotes = (about.quotes || []).filter((q) => q.text);
  const credits = visibleCredits(site);
  const faqs = visibleFaqs(site);

  const body = `
  <section class="page-head">
    ${about.kicker ? `<p class="eyebrow">${esc(about.kicker)}</p>` : ''}
    <h1 class="display${displayClass(about.title)}">${stackWords(about.title)}</h1>
    <div class="rule rule-accent"></div>
  </section>
  <section class="split">
    <div class="split-main">
      <div class="prose">${paragraphs || '<p class="muted">Add your bio in the admin panel.</p>'}</div>
      ${
        facts.length
          ? `<dl class="facts">${facts
              .map((f) => `<div class="fact"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`)
              .join('')}</dl>`
          : ''
      }
      ${
        faqs.length
          ? `<section class="faq">
              <h2 class="eyebrow">${esc(about.faqLabel || 'Questions')}</h2>
              <div class="rule"></div>
              <dl class="faq-list">${faqs
                .map(
                  (f) =>
                    `<div class="faq-item"><dt class="faq-q">${esc(f.question)}</dt><dd class="faq-a">${esc(
                      f.answer
                    )}</dd></div>`
                )
                .join('')}</dl>
            </section>`
          : ''
      }
      ${
        credits.length
          ? `<section class="credits">
              <h2 class="eyebrow">${esc(about.creditsLabel || 'Selected credits')}</h2>
              <ul class="credit-list">${credits.map(renderCredit).join('')}</ul>
            </section>`
          : ''
      }
    </div>
    <aside class="split-side">
      ${
        about.photo
          ? `<div class="side-photo"><img src="${esc(about.photo)}" alt="${esc(about.photoAlt)}" loading="lazy" decoding="async"></div>`
          : `<div class="side-photo"><span class="photo-placeholder">${esc(site.home.photoPlaceholder)}</span></div>`
      }
    </aside>
  </section>
  ${
    quotes.length
      ? `<section class="quotes">${quotes
          .map(
            (q) =>
              `<blockquote class="quote"><p>${esc(q.text)}</p>${q.source ? `<cite>${esc(q.source)}</cite>` : ''}</blockquote>`
          )
          .join('')}</section>`
      : ''
  }`;

  return layout(site, {
    title: `About — ${site.brand.name}`,
    description: (about.body && about.body[0]) || site.seo.description,
    current: '/about',
    bodyClass: 'page-about',
    origin: ctx.origin,
    body
  });
}

function renderLinks(site, ctx = {}) {
  const links = (site.links.items || []).filter((l) => l.visible !== false && l.url);
  const href = (link) => link.url;
  const external = (link) => (/^https?:/i.test(link.url) ? ' target="_blank" rel="noopener"' : '');

  const upcoming = upcomingShows(site);
  const past = pastShows(site).slice(0, 6);

  const body = `
  <section class="page-head">
    ${site.links.kicker ? `<p class="eyebrow">${esc(site.links.kicker)}</p>` : ''}
    <h1 class="display${displayClass(site.links.title)}">${stackWords(site.links.title)}</h1>
    <div class="rule rule-accent"></div>
    ${site.links.intro ? `<p class="subhead">${esc(site.links.intro)}</p>` : ''}
  </section>
  <section class="link-grid">
    ${
      links.length
        ? links
            .map(
              (link) => `<a class="link-card${link.featured ? ' is-featured' : ''}" href="${esc(href(link))}"${/^https?:/i.test(link.url) ? ` data-tracked-link="/go/${encodeURIComponent(link.id)}"` : ''}${external(link)}>
        <span class="link-label">${esc(link.label)}</span>
        ${link.sublabel ? `<span class="link-sub">${esc(link.sublabel)}</span>` : ''}
        <span class="link-arrow" aria-hidden="true">&rarr;</span>
      </a>`
            )
            .join('')
        : '<p class="muted">No links yet. Add them in the admin panel.</p>'
    }
  </section>
  ${
    upcoming.length
      ? `<section class="dates" id="shows">
          <h2 class="eyebrow">${esc(site.home.upcoming.label)}</h2>
          <div class="rule"></div>
          <ul class="show-list">${upcoming.map((s) => renderShowRow(s)).join('')}</ul>
        </section>`
      : ''
  }
  ${
    past.length
      ? `<section class="dates dates-past">
          <h2 class="eyebrow">Past</h2>
          <div class="rule"></div>
          <ul class="show-list">${past.map((s) => renderShowRow(s)).join('')}</ul>
        </section>`
      : ''
  }`;

  return layout(site, {
    title: `Links — ${site.brand.name}`,
    description: site.links.intro || site.seo.description,
    current: '/links',
    bodyClass: 'page-links',
    origin: ctx.origin,
    body
  });
}

function visibleReels(site) {
  return ((site.reels && site.reels.items) || []).filter((r) => r.visible !== false && (r.video || r.poster || r.url));
}

/** A permanent, server-rendered calendar using the same admin-managed dates. */
function renderShows(site, ctx = {}) {
  const upcoming = upcomingShows(site);
  const past = pastShows(site).slice(0, 20);
  const body = `<section class="page-head">
    <p class="eyebrow">Live stand-up comedy</p>
    <h1 class="display">Shows</h1>
    <div class="rule rule-accent"></div>
    <p class="subhead">Upcoming performances and tickets for ${esc(site.brand.name)}.</p>
  </section>
  <section class="dates"><h2 class="eyebrow">Upcoming shows</h2>
    ${upcoming.length ? `<ul class="show-list">${upcoming.map(renderShowRow).join('')}</ul>` : '<p>No upcoming dates are listed right now. Check back for announcements.</p>'}
  </section>
  ${past.length ? `<section class="dates dates-past"><h2 class="eyebrow">Past appearances</h2><ul class="show-list">${past.map(renderShowRow).join('')}</ul></section>` : ''}
  <div class="cta-row"><a class="btn" href="/contact">Booking enquiries</a><a class="btn" href="/about">About ${esc(site.brand.name)}</a></div>`;
  return layout(site, {
    title: `${site.brand.name} — Shows and tickets`,
    description: `Upcoming stand-up comedy performances, tickets and past appearances for ${site.brand.name}.`,
    current: '/shows', bodyClass: 'page-shows', origin: ctx.origin, body
  });
}

/**
 * The reel wall: one edge-to-edge grid, no padding and no gaps, every tile the
 * 9:16 a reel is shot in.
 *
 * A tile plays silently on a loop when it has a video of its own. Instagram's
 * embed cannot be made to autoplay from another site — that is their player's
 * decision, not a setting — so a reel with only a permalink falls back to the
 * embed, and one with a poster falls back to the still. Muted + playsinline is
 * what lets a phone play it inline at all rather than going fullscreen.
 */
function renderReels(site, ctx = {}) {
  const head = site.reels || {};
  // Reels added by hand come first — they are the deliberate ones — and the
  // account's own feed follows, minus anything already pinned by permalink.
  const pinned = visibleReels(site);
  const seen = new Set(pinned.map((r) => String(r.url || '').replace(/\/+$/, '')));
  const feed = (ctx.remote || []).filter((r) => !seen.has(String(r.url || '').replace(/\/+$/, '')));
  const reels = pinned.concat(feed);

  const tile = (reel) => {
    const label = reel.caption || `${site.brand.name} on Instagram`;
    const inner = reel.video
      ? `<video class="reel-media" src="${esc(reel.video)}"${reel.poster ? ` poster="${esc(reel.poster)}"` : ''} muted loop playsinline preload="none" autoplay aria-label="${esc(label)}"></video>`
      : reel.poster
        ? `<img class="reel-media" src="${esc(reel.poster)}" alt="${esc(label)}" loading="lazy" decoding="async">`
        : `<iframe class="reel-media reel-embed" src="${esc(reel.url.replace(/\/?(\?.*)?$/, '/'))}embed" title="${esc(label)}" loading="lazy" allowtransparency="true" frameborder="0" scrolling="no"></iframe>`;

    // An embed is already interactive; wrapping it in a link would swallow it.
    return reel.url && !(!reel.video && !reel.poster)
      ? `<a class="reel" href="${esc(reel.url)}" target="_blank" rel="noopener"><span class="sr-only">${esc(label)}</span>${inner}</a>`
      : `<div class="reel">${inner}</div>`;
  };

  const body = `
  <section class="reel-head">
    <h1 class="reel-title">${esc(head.title || 'Reels')}</h1>
    ${head.intro ? `<p class="reel-intro">${esc(head.intro)}</p>` : ''}
  </section>
  ${
    reels.length
      ? `<section class="reel-grid">${reels.map(tile).join('')}</section>`
      : ctx.profile
        ? // Instagram will not hand a server the list of posts, but it will
          // render its own widget inside a visitor's browser. Letting their
          // player do the work needs no app, no token and no login.
          `<section class="reel-frame">
            <iframe
              class="reel-profile"
              src="https://www.instagram.com/${esc(ctx.profile)}/embed/"
              title="${esc(site.brand.name)} on Instagram"
              loading="lazy"
              allowtransparency="true"
              allow="encrypted-media"
              frameborder="0"
              scrolling="no"></iframe>
          </section>
          <section class="reel-offsite">
            <a class="btn btn-accent" href="${esc(ctx.profileUrl || `https://www.instagram.com/${ctx.profile}/reels/`)}" target="_blank" rel="me noopener">All reels on Instagram &nearr;</a>
          </section>`
        : ctx.profileUrl
          ? `<section class="reel-offsite">
              <p class="reel-offsite-line">The reels live on Instagram.</p>
              <a class="btn btn-accent" href="${esc(ctx.profileUrl)}" target="_blank" rel="me noopener">Watch on Instagram</a>
            </section>`
        : `<section class="reel-empty"><p class="muted">${
            ctx.error ? 'Reels are unavailable just now.' : 'No reels yet. Add them in the admin panel.'
          }</p></section>`
  }`;

  return layout(site, {
    title: `${head.title || 'Reels'} — ${site.brand.name}`,
    description: head.intro || `Reels and clips from ${site.brand.name}.`,
    current: '/reels',
    bodyClass: 'page-reels',
    origin: ctx.origin,
    body
  });
}

/**
 * A small game, for no reason. Hecklers pop up in a grid of seats and the
 * visitor taps them before they get a word in. It sits outside the sitemap
 * and carries noindex: it is a bit of fun on the way past, not a page anyone
 * needs to find.
 */
function renderPlay(site, ctx = {}) {
  const seats = Array.from({ length: 12 }, (_, i) =>
    `<button class="seat" type="button" data-seat="${i}"><span class="seat-face" aria-hidden="true"></span><span class="sr-only">Seat ${i + 1}</span></button>`
  ).join('');
  const body = `
  <section class="play">
    <p class="eyebrow">For no reason</p>
    <h1 class="display display-sm">Shush the heckler</h1>
    <div class="rule rule-accent"></div>
    <p class="subhead">Hecklers pop up in the crowd. Tap them before they get a word in. Thirty seconds, one mic.</p>
    <div class="play-bar" aria-live="off">
      <span class="play-stat"><span class="play-stat-label">Shushed</span><strong id="play-score">0</strong></span>
      <span class="play-stat"><span class="play-stat-label">Seconds</span><strong id="play-time">30</strong></span>
      <span class="play-stat"><span class="play-stat-label">Best</span><strong id="play-best">0</strong></span>
    </div>
    <div class="play-grid" id="play-grid" role="group" aria-label="The crowd">${seats}</div>
    <div class="cta-row">
      <button class="btn btn-accent" type="button" id="play-start">Start the set</button>
    </div>
    <p class="play-line" id="play-line" role="status" aria-live="polite"></p>
  </section>
  <script src="/assets/js/play.js" defer></script>`;
  return layout(site, {
    title: `Play — ${site.brand.name}`,
    description: `A tiny game on ${site.brand.name}'s site. Shush the hecklers.`,
    current: '/play',
    bodyClass: 'page-play',
    origin: ctx.origin,
    noindex: true,
    body
  });
}

function renderNotFound(site, ctx = {}) {
  const body = `
  <section class="page-head">
    <p class="eyebrow">404</p>
    <h1 class="display">Not<br>Found</h1>
    <div class="rule rule-accent"></div>
    <p class="subhead">That page does not exist.</p>
    <div class="cta-row"><a class="btn btn-accent" href="/">Home</a></div>
  </section>`;
  return layout(site, {
    title: `Not found — ${site.brand.name}`,
    description: 'Page not found',
    current: '',
    bodyClass: 'page-404',
    origin: ctx.origin,
    noindex: true,
    body
  });
}

/**
 * /llms.txt — the convention answer engines are converging on for "tell me what
 * this site is in one fetch" (llmstxt.org). Plain markdown, generated from the
 * same content the pages render, so it can never say something the site does
 * not. It is an index, not a second version of the site.
 */
function llmsTxt(site, origin = '') {
  const abs = (path) => `${origin}${path}`;
  const out = [`# ${site.brand.name}`, ''];

  const summary = [site.brand.accentLabel, site.brand.location].filter(Boolean).join(' · ');
  if (summary) out.push(`> ${summary}`, '');
  if (site.seo.description) out.push(site.seo.description, '');

  const bio = ((site.about && site.about.body) || []).filter((p) => String(p || '').trim());
  if (bio.length) out.push('## About', '', ...bio.flatMap((p) => [p, '']));

  // High in the file, because it answers the questions this file exists for.
  const faqs = visibleFaqs(site);
  if (faqs.length) {
    out.push(`## ${site.about.faqLabel || 'Questions'}`, '');
    for (const f of faqs) out.push(`### ${f.question}`, '', f.answer, '');
  }

  out.push('## Pages', '');
  out.push(`- [${site.seo.title || site.brand.name}](${abs('/')}): home`);
  out.push(`- [About](${abs('/about')}): biography and booking details`);
  out.push(`- [Shows](${abs('/shows')}): upcoming performances, tickets and past appearances`);
  out.push(`- [Contact](${abs('/contact')}): booking enquiries`);
  out.push(`- [${site.links.title || 'Links'}](${abs('/links')}): every profile and project in one place`);
  if (visibleReels(site).length) {
    out.push(`- [${(site.reels && site.reels.title) || 'Reels'}](${abs('/reels')}): short video clips`);
  }
  out.push('');

  const links = (site.links.items || []).filter((l) => l.visible !== false && l.label && l.url);
  if (links.length) {
    out.push('## Links', '');
    for (const l of links) out.push(`- [${l.label}](${l.url})${l.sublabel ? `: ${l.sublabel}` : ''}`);
    out.push('');
  }

  const credits = visibleCredits(site);
  if (credits.length) {
    out.push(`## ${site.about.creditsLabel || 'Selected credits'}`, '');
    for (const c of credits) {
      const meta = [c.detail, c.year].filter(Boolean).join(', ');
      const name = c.url ? `[${c.title}](${c.url})` : c.title;
      out.push(`- ${name}${meta ? ` — ${meta}` : ''}${c.award ? ' (award)' : ''}`);
    }
    out.push('');
  }

  const shows = upcomingShows(site).filter((sh) => sh.venue);
  if (shows.length) {
    out.push('## Upcoming shows', '');
    for (const sh of shows) {
      const when = [sh.date, sh.time].filter(Boolean).join(' ');
      const where = [sh.venue, sh.city].filter(Boolean).join(', ');
      out.push(`- ${[when, where].filter(Boolean).join(' — ')}${sh.soldOut ? ' (sold out)' : ''}`);
    }
    out.push('');
  }

  const facts = ((site.about && site.about.facts) || []).filter((f) => f.label && f.value);
  if (site.brand.email || facts.length) {
    out.push('## Contact', '');
    for (const f of facts) out.push(`- ${f.label}: ${f.value}`);
    // Two different booking addresses would be worse than none, so the brand
    // email is only added when the facts do not already answer the question.
    const answered = facts.some((f) => /book|contact|e-?mail|enquir|inquir/i.test(f.label) || /@/.test(f.value));
    if (site.brand.email && !answered) out.push(`- Booking: ${site.brand.email}`);
    out.push('');
  }

  if (site.meta && site.meta.updatedAt) out.push(`Last updated: ${site.meta.updatedAt.slice(0, 10)}`, '');
  return out.join('\n');
}

/** The two letters that still read when the icon is 16 pixels across. */
function initials(name) {
  const parts = words(name).filter((w) => /[a-z0-9]/i.test(w));
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * The tab icon, drawn rather than uploaded. Two letters at this size is the
 * most that survives; a wordmark or a face does not. Light and dark variants
 * exist because a black square vanishes into a dark tab strip and a white one
 * vanishes into a light strip — the browser picks by `media`.
 */
function faviconSvg(site, { dark = false } = {}) {
  const options = (site.themes && site.themes.options) || [];
  const active = options.find((o) => o.id === (site.themes && site.themes.default)) || {};
  const ink = dark ? active.bg || '#0b0b0b' : active.text || '#ffffff';
  const field = dark ? active.text || '#ffffff' : active.bg || '#0b0b0b';
  const mark = esc(initials(site.brand.logoText || site.brand.name));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${esc(
    site.brand.name
  )}"><rect width="64" height="64" fill="${esc(field)}"/><text x="32" y="45.5" text-anchor="middle" fill="${esc(
    ink
  )}" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" font-size="38" font-weight="900" letter-spacing="-1.5">${mark}</text></svg>\n`;
}

/** Lets a phone add the site to a home screen with a name and a real icon. */
function webManifest(site) {
  const options = (site.themes && site.themes.options) || [];
  const active = options.find((o) => o.id === (site.themes && site.themes.default)) || {};
  const icons = [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }];
  if (site.seo.favicon) icons.push({ src: site.seo.favicon, sizes: '512x512', purpose: 'any' });
  return JSON.stringify(
    {
      name: site.brand.name,
      short_name: site.brand.logoText || site.brand.name,
      description: site.seo.description,
      start_url: '/',
      display: 'standalone',
      background_color: active.bg || '#0b0b0b',
      theme_color: active.bg || '#0b0b0b',
      icons
    },
    null,
    2
  );
}

/**
 * Contact — a message being composed rather than a form to fill in.
 *
 * There is no form handler behind it and there is not meant to be: a form
 * needs a place to post to, a spam defence and somewhere for the mail to land,
 * and the site already has a booking address that does all three. So the
 * fields show what the message will say and the send button is a `mailto:`
 * that hands the whole thing — address, subject and body — to whatever the
 * visitor writes mail in. Nothing to break, nothing to moderate, and it works
 * with scripting off like every other page here.
 */
function renderContact(site, ctx = {}) {
  // A site document saved before this page existed has no `contact` block at
  // all — readSite hands back what is stored, it does not re-normalise — so the
  // defaults stand in until someone saves the admin panel once.
  const contact = { ...defaultSite().contact, ...(site.contact || {}) };
  const to = contact.to || site.brand.email || '';
  const mailto = to
    ? `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(contact.subject || '')}`
    : '';

  const body = `
  <section class="page-head">
    ${contact.kicker ? `<p class="eyebrow">${esc(contact.kicker)}</p>` : ''}
    <h1 class="display${displayClass(contact.title)}">${stackWords(contact.title)}</h1>
    <div class="rule rule-accent"></div>
    ${contact.intro ? `<p class="subhead">${esc(contact.intro)}</p>` : ''}
  </section>
  <section class="compose">
    <dl class="compose-fields">
      <div class="compose-row">
        <dt>To</dt>
        <dd class="compose-value">${to ? esc(to) : '<span class="muted">Add a booking address in the admin panel.</span>'}</dd>
      </div>
      ${
        contact.subject
          ? `<div class="compose-row">
        <dt>Subject</dt>
        <dd class="compose-value">${esc(contact.subject)}</dd>
      </div>`
          : ''
      }
    </dl>
    ${contact.placeholder ? `<p class="compose-body muted">${esc(contact.placeholder)}</p>` : ''}
    ${
      mailto
        ? `<div class="cta-row">
        <a class="btn btn-accent" href="${esc(mailto)}">${esc(contact.sendLabel || 'Send')}</a>
        <a class="btn btn-ghost" href="/">Cancel</a>
      </div>`
        : ''
    }
  </section>`;

  return layout(site, {
    title: `Contact — ${site.brand.name}`,
    description: contact.intro || `Booking and contact for ${site.brand.name}.`,
    current: '/contact',
    bodyClass: 'page-contact',
    origin: ctx.origin,
    body
  });
}

module.exports = { renderHome, renderAbout, renderShows, renderLinks, renderReels, renderPlay, renderContact, renderNotFound, llmsTxt, faviconSvg, webManifest, esc };
