'use strict';

const { defaultSite } = require('./defaults');

const MAX_TEXT = 400;
const MAX_LONG_TEXT = 4000;
const MAX_LIST = 200;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function str(value, fallback = '', max = MAX_TEXT) {
  if (typeof value !== 'string') {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return fallback;
  }
  return value.replace(/\r\n/g, '\n').trim().slice(0, max);
}

function longStr(value, fallback = '') {
  return str(value, fallback, MAX_LONG_TEXT);
}

function bool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function int(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function color(value, fallback) {
  const s = String(value || '').trim();
  if (/^#[0-9a-fA-F]{3}$/.test(s) || /^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  return fallback;
}

/**
 * Links and buttons are rendered into href attributes, so only allow schemes
 * that cannot execute script.
 */
function url(value, fallback = '') {
  const s = str(value, '', 600);
  if (!s) return fallback;
  if (/^(https?:|mailto:|tel:|sms:)/i.test(s)) return s;
  if (s.startsWith('/') || s.startsWith('#')) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return `https://${s}`;
  return fallback;
}

/** Uploaded/served media paths only — never an external or javascript: URL. */
function mediaPath(value, fallback = '') {
  const s = str(value, '', 600);
  if (!s) return fallback;
  if (/^\/(uploads|assets)\/[\w./-]+$/.test(s) && !s.includes('..')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return fallback;
}

/**
 * Search Console and Bing hand out an opaque token — or the whole `<meta>` tag
 * to paste. Both are accepted, only the token is kept, and anything with a
 * character that could break out of an attribute is refused.
 */
function verificationToken(value, fallback = '') {
  const raw = str(value, '', 200);
  if (!raw) return typeof value === 'string' ? '' : fallback;
  const tag = /content=["']([^"']+)["']/.exec(raw);
  const token = (tag ? tag[1] : raw).trim();
  return /^[A-Za-z0-9_\-.:=]{1,180}$/.test(token) ? token : fallback;
}

function slugId(prefix, value, index) {
  const s = String(value || '').trim();
  if (/^[\w-]{1,64}$/.test(s)) return s;
  return `${prefix}-${Date.now().toString(36)}-${index}`;
}

function list(value, max = MAX_LIST) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max);
}

function normalizeCta(input, fallback) {
  const src = isObject(input) ? input : {};
  return {
    label: str(src.label, fallback.label, 60),
    href: url(src.href, fallback.href),
    visible: bool(src.visible, fallback.visible)
  };
}

/**
 * Take whatever the admin panel sent and produce a well-formed site document.
 * Unknown fields are dropped; missing fields fall back to the current document
 * (or the shipped defaults). `auth` is never taken from user input.
 */
function normalizeSite(input, current) {
  const base = current && isObject(current) ? current : defaultSite();
  const def = defaultSite();
  const src = isObject(input) ? input : {};

  const pick = (key) => (isObject(src[key]) ? src[key] : {});
  const cur = (key) => (isObject(base[key]) ? base[key] : def[key]);

  const brandSrc = pick('brand');
  const brandCur = cur('brand');
  const brand = {
    name: str(brandSrc.name, brandCur.name, 120),
    logoText: str(brandSrc.logoText, brandCur.logoText, 60),
    location: str(brandSrc.location, brandCur.location, 120),
    email: str(brandSrc.email, brandCur.email, 160),
    accentLabel: str(brandSrc.accentLabel, brandCur.accentLabel, 120)
  };

  const seoSrc = pick('seo');
  const seoCur = cur('seo');
  const seo = {
    title: str(seoSrc.title, seoCur.title, 200),
    description: str(seoSrc.description, seoCur.description, 400),
    ogImage: mediaPath(seoSrc.ogImage, seoCur.ogImage || ''),
    ogImageAlt: str(seoSrc.ogImageAlt, seoCur.ogImageAlt || '', 160),
    favicon: mediaPath(seoSrc.favicon, seoCur.favicon || ''),
    // A verification token is an opaque string, never a URL or markup.
    googleVerification: verificationToken(seoSrc.googleVerification, seoCur.googleVerification || ''),
    bingVerification: verificationToken(seoSrc.bingVerification, seoCur.bingVerification || '')
  };

  const navSrc = Array.isArray(src.nav) ? list(src.nav, 12) : base.nav || def.nav;
  const nav = list(navSrc, 12).map((item, i) => {
    const it = isObject(item) ? item : {};
    return {
      id: slugId('nav', it.id, i),
      label: str(it.label, 'Link', 40),
      href: url(it.href, '/'),
      visible: bool(it.visible, true)
    };
  });

  const homeSrc = pick('home');
  const homeCur = cur('home');
  const upSrc = isObject(homeSrc.upcoming) ? homeSrc.upcoming : {};
  const upCur = isObject(homeCur.upcoming) ? homeCur.upcoming : def.home.upcoming;
  const home = {
    kicker: str(homeSrc.kicker, homeCur.kicker, 80),
    headline: str(homeSrc.headline, homeCur.headline, 60),
    subhead: str(homeSrc.subhead, homeCur.subhead, 240),
    photo: mediaPath(homeSrc.photo, homeCur.photo || ''),
    photoAlt: str(homeSrc.photoAlt, homeCur.photoAlt, 160),
    photoPlaceholder: str(homeSrc.photoPlaceholder, homeCur.photoPlaceholder, 80),
    primaryCta: normalizeCta(homeSrc.primaryCta, homeCur.primaryCta || def.home.primaryCta),
    secondaryCta: normalizeCta(homeSrc.secondaryCta, homeCur.secondaryCta || def.home.secondaryCta),
    upcoming: {
      visible: bool(upSrc.visible, upCur.visible),
      label: str(upSrc.label, upCur.label, 40),
      emptyText: str(upSrc.emptyText, upCur.emptyText, 80),
      maxItems: int(upSrc.maxItems, upCur.maxItems, 1, 12),
      allShowsLabel: str(upSrc.allShowsLabel, upCur.allShowsLabel, 40)
    }
  };

  const aboutSrc = pick('about');
  const aboutCur = cur('about');
  const about = {
    kicker: str(aboutSrc.kicker, aboutCur.kicker, 80),
    title: str(aboutSrc.title, aboutCur.title, 120),
    photo: mediaPath(aboutSrc.photo, aboutCur.photo || ''),
    photoAlt: str(aboutSrc.photoAlt, aboutCur.photoAlt, 160),
    body: (Array.isArray(aboutSrc.body) ? list(aboutSrc.body, 40) : aboutCur.body || [])
      .map((p) => longStr(p, ''))
      .filter(Boolean),
    facts: list(Array.isArray(aboutSrc.facts) ? aboutSrc.facts : aboutCur.facts || [], 20).map((f, i) => {
      const it = isObject(f) ? f : {};
      return {
        id: slugId('fact', it.id, i),
        label: str(it.label, '', 60),
        value: str(it.value, '', 160)
      };
    }),
    creditsLabel: str(aboutSrc.creditsLabel, aboutCur.creditsLabel || 'Selected credits', 60),
    // Awards and screen credits, as data rather than as a sentence in the bio,
    // so they can be listed on the page and published as structured data.
    credits: list(Array.isArray(aboutSrc.credits) ? aboutSrc.credits : aboutCur.credits || [], 60).map((c, i) => {
      const it = isObject(c) ? c : {};
      return {
        id: slugId('credit', it.id, i),
        title: str(it.title, '', 160),
        detail: str(it.detail, '', 200),
        year: str(it.year, '', 12),
        url: url(it.url, ''),
        award: bool(it.award, false),
        visible: bool(it.visible, true)
      };
    }),
    quotes: list(Array.isArray(aboutSrc.quotes) ? aboutSrc.quotes : aboutCur.quotes || [], 20).map((q, i) => {
      const it = isObject(q) ? q : {};
      return {
        id: slugId('quote', it.id, i),
        text: longStr(it.text, ''),
        source: str(it.source, '', 120)
      };
    }),
    faqLabel: str(aboutSrc.faqLabel, aboutCur.faqLabel || def.about.faqLabel, 60),
    // A question and its answer, in her words. Published on the page and as
    // structured data, so the answer a machine repeats is the one she wrote.
    faqs: list(Array.isArray(aboutSrc.faqs) ? aboutSrc.faqs : aboutCur.faqs || [], 30).map((f, i) => {
      const it = isObject(f) ? f : {};
      return {
        id: slugId('faq', it.id, i),
        question: str(it.question, '', 200),
        answer: longStr(it.answer, ''),
        visible: bool(it.visible, true)
      };
    })
  };

  const linksSrc = pick('links');
  const linksCur = cur('links');
  const linkItemsCur = Array.isArray(linksCur.items) ? linksCur.items : [];
  const clicksById = new Map(linkItemsCur.map((it) => [it.id, Number(it.clicks) || 0]));
  const links = {
    kicker: str(linksSrc.kicker, linksCur.kicker, 80),
    title: str(linksSrc.title, linksCur.title, 120),
    intro: longStr(linksSrc.intro, linksCur.intro || ''),
    items: list(Array.isArray(linksSrc.items) ? linksSrc.items : linkItemsCur, 100).map((item, i) => {
      const it = isObject(item) ? item : {};
      const id = slugId('link', it.id, i);
      return {
        id,
        label: str(it.label, 'Link', 80),
        sublabel: str(it.sublabel, '', 160),
        url: url(it.url, ''),
        visible: bool(it.visible, true),
        featured: bool(it.featured, false),
        // Click counts belong to the server, not to whatever the form posted.
        clicks: clicksById.has(id) ? clicksById.get(id) : Math.max(0, Number(it.clicks) || 0)
      };
    })
  };

  const reelsSrc = pick('reels');
  const reelsCur = cur('reels');
  const reelItemsCur = Array.isArray(reelsCur.items) ? reelsCur.items : [];
  const reels = {
    // One pasted link from a hosted Instagram connector (Behold and the like).
    // It is the whole setup: log in there once, paste the URL here.
    feedUrl: url(reelsSrc.feedUrl, reelsCur.feedUrl || ''),
    kicker: str(reelsSrc.kicker, reelsCur.kicker, 80),
    title: str(reelsSrc.title, reelsCur.title, 120),
    intro: longStr(reelsSrc.intro, reelsCur.intro || ''),
    items: list(Array.isArray(reelsSrc.items) ? reelsSrc.items : reelItemsCur, 120).map((item, i) => {
      const it = isObject(item) ? item : {};
      return {
        id: slugId('reel', it.id, i),
        url: url(it.url, ''),
        // The looping file. An uploaded path or an external URL — both are
        // played the same way, and neither is trusted as markup.
        video: mediaPath(it.video, ''),
        poster: mediaPath(it.poster, ''),
        caption: str(it.caption, '', 200),
        visible: bool(it.visible, true)
      };
    })
  };

  const showsCur = Array.isArray(base.shows) ? base.shows : [];
  const shows = list(Array.isArray(src.shows) ? src.shows : showsCur, 200).map((show, i) => {
    const it = isObject(show) ? show : {};
    return {
      id: slugId('show', it.id, i),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(it.date || '')) ? String(it.date) : '',
      time: str(it.time, '', 20),
      venue: str(it.venue, '', 120),
      city: str(it.city, '', 120),
      // Google's Event rich result wants a real PostalAddress, not a city
      // string. These are optional — a gig with only a city still validates,
      // it just competes less well than one with a findable street address.
      street: str(it.street, '', 160),
      postalCode: str(it.postalCode, '', 20),
      country: str(it.country, '', 60),
      url: url(it.url, ''),
      ctaLabel: str(it.ctaLabel, 'Tickets', 30),
      note: str(it.note, '', 200),
      soldOut: bool(it.soldOut, false),
      visible: bool(it.visible, true)
    };
  });

  const footerSrc = pick('footer');
  const footerCur = cur('footer');
  const footer = {
    left: str(footerSrc.left, footerCur.left, 160),
    right: str(footerSrc.right, footerCur.right, 160),
    rightHref: url(footerSrc.rightHref, footerCur.rightHref || ''),
    note: str(footerSrc.note, footerCur.note || '', 240)
  };

  const themesSrc = pick('themes');
  const themesCur = cur('themes');
  const themeOptionsCur = Array.isArray(themesCur.options) ? themesCur.options : def.themes.options;
  const options = list(Array.isArray(themesSrc.options) ? themesSrc.options : themeOptionsCur, 6).map((opt, i) => {
    const it = isObject(opt) ? opt : {};
    const fb = themeOptionsCur[i] || def.themes.options[i] || def.themes.options[0];
    return {
      id: /^[A-Za-z0-9]{1,3}$/.test(String(it.id || '')) ? String(it.id).toUpperCase() : fb.id,
      name: str(it.name, fb.name, 30),
      bg: color(it.bg, fb.bg),
      surface: color(it.surface, fb.surface),
      text: color(it.text, fb.text),
      muted: color(it.muted, fb.muted),
      accent: color(it.accent, fb.accent),
      accentText: color(it.accentText, fb.accentText),
      line: color(it.line, fb.line)
    };
  });
  const safeOptions = options.length ? options : def.themes.options;
  const themes = {
    default: safeOptions.some((o) => o.id === themesSrc.default)
      ? themesSrc.default
      : safeOptions.some((o) => o.id === themesCur.default)
        ? themesCur.default
        : safeOptions[0].id,
    options: safeOptions
  };

  return {
    version: 1,
    brand,
    seo,
    nav,
    home,
    about,
    links,
    reels,
    shows,
    footer,
    themes,
    // Credentials are managed through their own endpoint only.
    auth: isObject(base.auth) ? base.auth : def.auth,
    meta: { updatedAt: new Date().toISOString() }
  };
}

/** Strip anything a public visitor should never receive. */
function publicSite(site) {
  const clone = JSON.parse(JSON.stringify(site));
  delete clone.auth;
  return clone;
}

module.exports = { normalizeSite, publicSite, isObject };
