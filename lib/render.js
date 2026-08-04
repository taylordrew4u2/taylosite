'use strict';

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

function renderNav(site, current) {
  return (site.nav || [])
    .filter((item) => item.visible !== false)
    .map(
      (item) =>
        `<a class="nav-link${item.href === current ? ' is-active' : ''}" href="${esc(item.href)}">${esc(item.label)}</a>`
    )
    .join('');
}

function renderThemeSwitch(site) {
  if (!site.themes || site.themes.showSwitcher === false) return '';
  const buttons = (site.themes.options || [])
    .map(
      (t) =>
        `<button type="button" class="theme-btn" data-theme-id="${esc(t.id)}" title="${esc(t.name)}" aria-label="Theme ${esc(t.name)}">${esc(t.id)}</button>`
    )
    .join('');
  return `<div class="theme-switch" role="group" aria-label="Colour theme">${buttons}</div>`;
}

function renderHeader(site, current) {
  return `
  <header class="topbar">
    <a class="logo" href="/">${esc(site.brand.logoText || site.brand.name)}</a>
    <div class="topbar-right">
      <nav class="nav" aria-label="Primary">${renderNav(site, current)}</nav>
      ${renderThemeSwitch(site)}
      <a class="btn btn-ghost btn-admin" href="/admin">Admin</a>
    </div>
    <button class="menu-toggle" type="button" aria-label="Menu" aria-expanded="false"><span></span><span></span></button>
  </header>`;
}

function renderFooter(site) {
  const right = site.footer.rightHref
    ? `<a class="footer-right" href="${esc(site.footer.rightHref)}">${esc(site.footer.right)}</a>`
    : `<span class="footer-right">${esc(site.footer.right)}</span>`;
  return `
  <footer class="footer">
    <span class="footer-left">${esc(site.footer.left)}</span>
    ${site.footer.note ? `<span class="footer-note">${esc(site.footer.note)}</span>` : ''}
    ${right}
  </footer>`;
}

function layout(site, { title, description, current, body, bodyClass = '' }) {
  const theme = (site.themes && site.themes.default) || 'A';
  const favicon = site.seo.favicon
    ? `<link rel="icon" href="${esc(site.seo.favicon)}">`
    : '<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><rect width=%2232%22 height=%2232%22 fill=%22%23ef4123%22/></svg>">';
  const ogImage = site.seo.ogImage ? `<meta property="og:image" content="${esc(site.seo.ogImage)}">` : '';
  return `<!doctype html>
<html lang="en" data-theme="${esc(theme)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
${ogImage}
${favicon}
<link rel="stylesheet" href="/assets/css/site.css">
<style>${themeCss(site.themes || {})}</style>
<script>
  // Apply the saved theme before first paint so there is no flash.
  try {
    var t = localStorage.getItem('td-theme');
    var ids = ${JSON.stringify((site.themes.options || []).map((o) => o.id))};
    if (t && ids.indexOf(t) !== -1) document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
</script>
</head>
<body class="${esc(bodyClass)}">
${renderHeader(site, current)}
<main class="main">
${body}
</main>
${renderFooter(site)}
<script src="/assets/js/site.js" defer></script>
</body>
</html>`;
}

function renderShowRow(show, { compact = false } = {}) {
  const d = formatDate(show.date);
  const dateBlock = d.day
    ? `<span class="show-date"><span class="show-month">${esc(d.month)}</span><span class="show-day">${esc(d.day)}</span></span>`
    : '<span class="show-date"><span class="show-month">TBA</span></span>';
  // The venue is already the row's title — the meta line carries city and time.
  const meta = [show.city].filter(Boolean).map(esc).join(' · ');
  const cta = show.soldOut
    ? '<span class="show-cta is-soldout">Sold out</span>'
    : show.url
      ? `<a class="show-cta" href="${esc(show.url)}" target="_blank" rel="noopener">${esc(show.ctaLabel || 'Tickets')}</a>`
      : '';
  return `<li class="show${compact ? ' show-compact' : ''}">
    ${dateBlock}
    <span class="show-body">
      <span class="show-venue">${esc(show.venue || 'To be announced')}</span>
      <span class="show-meta">${meta}${show.time ? ` · ${esc(show.time)}` : ''}</span>
      ${show.note ? `<span class="show-note">${esc(show.note)}</span>` : ''}
    </span>
    ${cta}
  </li>`;
}

function renderHome(site) {
  const home = site.home;
  const shows = upcomingShows(site).slice(0, home.upcoming.maxItems || 3);
  const photo = home.photo
    ? `<img class="hero-photo" src="${esc(home.photo)}" alt="${esc(home.photoAlt)}">`
    : `<span class="photo-placeholder">${esc(home.photoPlaceholder)}</span>`;

  const upcoming = home.upcoming.visible
    ? `<div class="hero-upcoming">
        <p class="eyebrow">${esc(home.upcoming.label)}</p>
        <div class="rule"></div>
        ${
          shows.length
            ? `<ul class="show-list">${shows.map((s) => renderShowRow(s, { compact: true })).join('')}</ul>`
            : `<p class="display display-sm${displayClass(home.upcoming.emptyText)}">${stackWords(home.upcoming.emptyText)}</p>`
        }
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
    <aside class="hero-side">
      <div class="hero-photo-wrap">${photo}</div>
      ${upcoming}
    </aside>
  </section>`;

  return layout(site, {
    title: site.seo.title,
    description: site.seo.description,
    current: '/',
    bodyClass: 'page-home',
    body
  });
}

function renderAbout(site) {
  const about = site.about;
  const paragraphs = (about.body || []).map((p) => `<p>${esc(p)}</p>`).join('');
  const facts = (about.facts || []).filter((f) => f.label || f.value);
  const quotes = (about.quotes || []).filter((q) => q.text);

  const body = `
  <section class="page-head">
    ${about.kicker ? `<p class="eyebrow">${esc(about.kicker)}</p>` : ''}
    <h1 class="display${displayClass(about.title)}">${stackWords(about.title)}</h1>
    <div class="rule rule-accent"></div>
  </section>
  <section class="split">
    <div class="split-main prose">${paragraphs || '<p class="muted">Add your bio in the admin panel.</p>'}</div>
    <aside class="split-side">
      ${
        about.photo
          ? `<div class="side-photo"><img src="${esc(about.photo)}" alt="${esc(about.photoAlt)}"></div>`
          : `<div class="side-photo"><span class="photo-placeholder">${esc(site.home.photoPlaceholder)}</span></div>`
      }
      ${
        facts.length
          ? `<dl class="facts">${facts
              .map((f) => `<div class="fact"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`)
              .join('')}</dl>`
          : ''
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
    body
  });
}

function renderLinks(site) {
  const links = (site.links.items || []).filter((l) => l.visible !== false && l.url);
  const href = (link) => (/^https?:/i.test(link.url) ? `/go/${encodeURIComponent(link.id)}` : link.url);
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
              (link) => `<a class="link-card${link.featured ? ' is-featured' : ''}" href="${esc(href(link))}"${external(link)}>
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
      ? `<section class="dates">
          <p class="eyebrow">${esc(site.home.upcoming.label)}</p>
          <div class="rule"></div>
          <ul class="show-list">${upcoming.map((s) => renderShowRow(s)).join('')}</ul>
        </section>`
      : ''
  }
  ${
    past.length
      ? `<section class="dates dates-past">
          <p class="eyebrow">Past</p>
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
    body
  });
}

function renderNotFound(site) {
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
    body
  });
}

module.exports = { renderHome, renderAbout, renderLinks, renderNotFound, esc };
