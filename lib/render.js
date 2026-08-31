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
    .map((item) => {
      const active = item.href === current;
      return `<a class="nav-link${active ? ' is-active' : ''}" href="${esc(item.href)}"${active ? ' aria-current="page"' : ''}>${esc(item.label)}</a>`;
    })
    .join('');
}

function renderHeader(site, current) {
  return `
  <header class="topbar">
    <a class="logo" href="/">${esc(site.brand.logoText || site.brand.name)}</a>
    <div class="topbar-right" id="site-menu">
      <nav class="nav" aria-label="Primary">${renderNav(site, current)}</nav>
    </div>
    <button class="menu-toggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="site-menu"><span></span><span></span></button>
  </header>`;
}

/** "Brooklyn, NY" -> a PostalAddress search engines can actually read. */
function postalAddress(city) {
  const text = String(city || '').trim();
  if (!text) return null;
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { '@type': 'PostalAddress', addressLocality: text };
  return {
    '@type': 'PostalAddress',
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
  /(?:^|\.)(?:instagram|tiktok|youtube|x|twitter|facebook|threads|bsky|linkedin|spotify|patreon|substack|imdb|vimeo|soundcloud|bandcamp|letterboxd|twitch|tumblr|discogs|wikipedia|wikidata|podcasts\.apple|music\.apple)\.(?:com|app|social|me|tv|org|net|fm)$/i;

function identityLinks(site) {
  return (site.links.items || [])
    .filter((l) => l.visible !== false && /^https?:/i.test(l.url))
    .map((l) => {
      try {
        return { url: l.url, host: new URL(l.url).hostname };
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .filter((l) => IDENTITY_HOSTS.test(l.host));
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
  const websiteId = `${origin}/#website`;
  const personId = `${origin}/#person`;
  const pageId = `${canonical}#webpage`;
  const imageId = `${origin}/#primaryimage`;
  const listId = `${origin}/links#list`;

  // A named node rather than a bare URL, so the same photo can be pointed at
  // from the person and from each page instead of being repeated as a string.
  const primaryImage = site.home.photo
    ? {
        '@type': 'ImageObject',
        '@id': imageId,
        url: origin + site.home.photo,
        contentUrl: origin + site.home.photo,
        caption: site.home.photoAlt || site.brand.name
      }
    : null;

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
    ...(site.brand.email ? { email: `mailto:${site.brand.email}` } : {}),
    ...(site.brand.location
      ? { homeLocation: { '@type': 'Place', name: site.brand.location }, address: postalAddress(site.brand.location) }
      : {}),
    ...(primaryImage ? { image: { '@id': imageId } } : {}),
    ...(sameAs.length ? { sameAs } : {})
  };

  // The bio says far more about her than the meta description, and it is the
  // paragraph an answer engine will quote if it has it.
  const bio = ((site.about && site.about.body) || []).find((p) => String(p || '').trim());
  if (bio) person.description = bio;

  // "TAYLOR DREW" is the same name; a genuinely different logo text is not.
  const logoText = String(site.brand.logoText || '').trim();
  if (logoText && logoText.toLowerCase() !== String(site.brand.name || '').toLowerCase()) {
    person.alternateName = logoText;
  }

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

  if (site.brand.accentLabel) {
    person.hasOccupation = {
      '@type': 'Occupation',
      name: site.brand.accentLabel,
      ...(site.brand.location
        ? { occupationLocation: { '@type': 'City', name: site.brand.location } }
        : {})
    };
  }

  const pageTypes = { '/': 'ProfilePage', '/about': 'AboutPage', '/links': 'CollectionPage' };
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
    ...(primaryImage ? { primaryImageOfPage: { '@id': imageId } } : {}),
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

  const events = upcomingShows(site)
    .filter((show) => show.date && show.venue)
    .map((show) => {
      const address = postalAddress(show.city);
      return {
        '@type': 'Event',
        '@id': `${origin}/#show-${encodeURIComponent(show.id)}`,
        name: `${site.brand.name} at ${show.venue}`,
        startDate: show.date,
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: {
          '@type': 'Place',
          name: show.venue,
          ...(address ? { address } : {})
        },
        performer: { '@id': personId },
        organizer: { '@id': personId },
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
        ...(show.soldOut && !show.url ? { offers: { '@type': 'Offer', availability: 'https://schema.org/SoldOut' } } : {})
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
      ...(primaryImage ? [primaryImage] : []),
      ...works,
      ...itemList,
      ...breadcrumb,
      ...events
    ]
  };
  return `<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, '\\u003c')}</script>`;
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
  const favicon = site.seo.favicon
    ? `<link rel="icon" href="${esc(site.seo.favicon)}">`
    : `<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><rect width=%2232%22 height=%2232%22 fill=%22${encodeURIComponent(accent)}%22/></svg>">`;
  const shareImage = site.seo.ogImage || site.home.photo;
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
<meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:site_name" content="${esc(site.brand.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="${current === '/' ? 'profile' : 'website'}">
<meta property="og:locale" content="en_US">
${current === '/' ? profileMeta(site) : ''}
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
${shareImage ? `<meta property="og:image" content="${esc(absolute(shareImage))}">\n<meta property="og:image:alt" content="${esc(site.home.photoAlt || site.brand.name)}">` : ''}
<meta name="twitter:card" content="${shareImage ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${twitter ? `<meta name="twitter:creator" content="${esc(twitter)}">\n<meta name="twitter:site" content="${esc(twitter)}">` : ''}
${shareImage ? `<meta name="twitter:image" content="${esc(absolute(shareImage))}">` : ''}
${favicon}
${identityLinks(site)
  .map((l) => `<link rel="me" href="${esc(l.url)}">`)
  .join('\n')}
<link rel="stylesheet" href="/assets/css/site.css">
<style>${themeCss(site.themes || {})}</style>
</head>
<body class="${esc(bodyClass)}">
<a class="skip-link" href="#main">Skip to content</a>
${renderHeader(site, current)}
<main class="main" id="main" tabindex="-1">
${body}
</main>
${renderFooter(site)}
${origin ? jsonLd(site, { origin, canonical, title, current }) : ''}
<script src="/assets/js/site.js" defer></script>
</body>
</html>`;
}

function renderShowRow(show, { compact = false } = {}) {
  const d = formatDate(show.date);
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
  const photo = home.photo
    ? `<img class="hero-photo" src="${esc(home.photo)}" alt="${esc(home.photoAlt)}" fetchpriority="high" decoding="async">`
    : `<span class="photo-placeholder">${esc(home.photoPlaceholder)}</span>`;

  const upcoming = home.upcoming.visible
    ? `<div class="hero-upcoming">
        <h2 class="eyebrow">${esc(home.upcoming.label)}</h2>
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
    origin: ctx.origin,
    body
  });
}

function visibleCredits(site) {
  return ((site.about && site.about.credits) || []).filter((c) => c.visible !== false && c.title);
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

  out.push('## Pages', '');
  out.push(`- [${site.seo.title || site.brand.name}](${abs('/')}): home`);
  out.push(`- [About](${abs('/about')}): biography and booking details`);
  out.push(`- [${site.links.title || 'Links'}](${abs('/links')}): every profile and project in one place`);
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

module.exports = { renderHome, renderAbout, renderLinks, renderNotFound, llmsTxt, esc };
