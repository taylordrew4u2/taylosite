/* Taylor Drew — admin panel.
   Vanilla JS, no build step. The whole site document lives in `state.site`;
   inputs bind to it by dot-path and everything saves in one atomic PUT. */
(function () {
  'use strict';

  // ------------------------------------------------------------------ state

  var state = {
    site: null,
    stats: null,
    sessions: [],
    media: [],
    backups: [],
    csrf: null,
    dirty: false,
    saving: false,
    section: 'overview',
    baseline: null,
    usingDefaultPassword: false,
    storage: '',
    health: null,
    instagram: null,
    mediaTarget: null,
    showFilter: 'all',
    expandedShows: {},
    flyer: null,
    flyerBusy: false,
    galleryBusy: false,
    aiEditor: null,
    aiLastProvider: null,
    aiLastModel: '',
    apiKey: null,
    // The one and only copy of a freshly minted key. Held in memory until the
    // section is left, then dropped: only its hash is stored, so once this is
    // gone there is nowhere to read it from again.
    freshApiKey: ''
  };

  function icon(paths) {
    return (
      '<svg class="side-icon" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" ' +
      'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>'
    );
  }

  var ICONS = {
    overview: '<rect x="1.5" y="1.5" width="5.5" height="5.5"/><rect x="9" y="1.5" width="5.5" height="5.5"/><rect x="1.5" y="9" width="5.5" height="5.5"/><rect x="9" y="9" width="5.5" height="5.5"/>',
    brand: '<path d="M8 1.5 9.7 6.3 14.5 8 9.7 9.7 8 14.5 6.3 9.7 1.5 8 6.3 6.3Z"/>',
    home: '<path d="M2 7 8 2l6 5"/><path d="M3.5 6.5V14h9V6.5"/>',
    links: '<path d="M6.5 9.5a3 3 0 0 0 4.3 0l2-2a3 3 0 0 0-4.3-4.3l-1 1"/><path d="M9.5 6.5a3 3 0 0 0-4.3 0l-2 2a3 3 0 0 0 4.3 4.3l1-1"/>',
    shows: '<rect x="1.5" y="3" width="13" height="11.5"/><path d="M1.5 6.5h13M5 1.5v3M11 1.5v3"/>',
    about: '<circle cx="8" cy="5.5" r="2.8"/><path d="M2.5 14.5a5.5 5.5 0 0 1 11 0"/>',
    nav: '<path d="M2 4h12M2 8h12M2 12h12"/>',
    themes: '<circle cx="8" cy="8" r="6.5"/><path d="M8 1.5a6.5 6.5 0 0 1 0 13Z" fill="currentColor" stroke="none"/>',
    contact: '<rect x="1.5" y="3" width="13" height="10"/><path d="M1.5 4 8 9l6.5-5"/>',
    footer: '<rect x="1.5" y="1.5" width="13" height="13"/><path d="M1.5 11h13"/>',
    media: '<rect x="1.5" y="2.5" width="13" height="11"/><circle cx="5.5" cy="6" r="1.2"/><path d="M2 12l3.5-3.5 3 3L11 8l3 3.5"/>',
    photos: '<rect x="1.5" y="2.5" width="13" height="11"/><circle cx="5.5" cy="6" r="1.2"/><path d="M2 12l3.5-3.5 3 3L11 8l3 3.5"/>',
    data: '<path d="M2 5h9l-2-2M14 11H5l2 2"/><path d="M2 5l2-2M14 11l-2 2"/>',
    ai: '<path d="M2 4h12M2 8h12M2 12h12"/><circle cx="5" cy="4" r="2"/><circle cx="11" cy="8" r="2"/>',
    security: '<rect x="3" y="7" width="10" height="7.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'
  };

  var SECTIONS = [
    { id: 'overview', label: 'Overview', hint: 'Everything at a glance.' },
    { id: 'brand', label: 'Brand & SEO', hint: 'Name, contact details and search listing.', keys: ['brand', 'seo'] },
    { id: 'home', label: 'Home page', hint: 'The hero, the photo and the upcoming block.', keys: ['home'] },
    { id: 'links', label: 'Links', hint: 'Every link, in the order they appear.', keys: ['links'] },
    { id: 'shows', label: 'Shows', hint: 'Tour dates shown on the home and links pages.', keys: ['shows'] },
    { id: 'reels', label: 'Reels', hint: 'The wall of clips.', keys: ['reels'] },
    { id: 'photos', label: 'Photos', hint: 'Your public photo gallery and image search descriptions.', keys: ['photos'] },
    { id: 'about', label: 'About page', hint: 'Bio, facts, credits, press quotes and questions.', keys: ['about'] },
    { id: 'contact', label: 'Contact page', hint: 'The message people send you.', keys: ['contact'] },
    { id: 'nav', label: 'Navigation', hint: 'The menu in the header.', keys: ['nav'] },
    { id: 'themes', label: 'Themes', hint: 'The colours the site is built from.', keys: ['themes'] },
    { id: 'footer', label: 'Footer', hint: 'The line at the bottom of every page.', keys: ['footer'] },
    { id: 'media', label: 'Media', hint: 'Uploaded images.' },
    { id: 'data', label: 'Backups & data', hint: 'Snapshots, export, import and reset.' },
    { id: 'ai', label: 'AI providers', hint: 'Your models, API keys and automatic fallback order.' },
    { id: 'security', label: 'Security', hint: 'Password, site access key and signed-in devices.' }
  ];

  var el = {
    login: document.getElementById('login'),
    loginForm: document.getElementById('login-form'),
    loginError: document.getElementById('login-error'),
    password: document.getElementById('password'),
    app: document.getElementById('app'),
    nav: document.getElementById('sidebar-nav'),
    panel: document.getElementById('panel'),
    title: document.getElementById('section-title'),
    hint: document.getElementById('section-hint'),
    saveState: document.getElementById('save-state'),
    save: document.getElementById('save'),
    revert: document.getElementById('revert'),
    previewToggle: document.getElementById('preview-toggle'),
    preview: document.getElementById('preview'),
    previewFrame: document.getElementById('preview-frame'),
    workspaceBody: document.querySelector('.workspace-body'),
    toasts: document.getElementById('toasts'),
    mediaModal: document.getElementById('media-modal'),
    modalGrid: document.getElementById('modal-media-grid'),
    modalUpload: document.getElementById('modal-upload'),
    modalUploadInput: document.getElementById('modal-upload-input')
  };

  // ---------------------------------------------------------------- helpers

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getPath(obj, path) {
    return String(path)
      .split('.')
      .reduce(function (acc, key) {
        return acc == null ? undefined : acc[key];
      }, obj);
  }

  function setPath(obj, path, value) {
    var keys = String(path).split('.');
    var last = keys.pop();
    var target = keys.reduce(function (acc, key) {
      if (acc[key] == null) acc[key] = /^\d+$/.test(key) ? [] : {};
      return acc[key];
    }, obj);
    target[last] = value;
  }

  function uid(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 9);
  }

  function toast(message, kind) {
    var node = document.createElement('div');
    node.className = 'toast is-' + (kind || 'info');
    node.textContent = message;
    el.toasts.appendChild(node);
    setTimeout(function () {
      node.remove();
    }, kind === 'error' ? 6000 : 3200);
  }

  function api(path, options) {
    options = options || {};
    var headers = { 'Content-Type': 'application/json' };
    if (state.csrf) headers['X-CSRF-Token'] = state.csrf;
    return fetch('/api' + path, {
      method: options.method || 'GET',
      headers: headers,
      credentials: 'same-origin',
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (res.status === 401 && state.site) {
            showLogin('Your session expired. Sign in again.');
            throw new Error('Session expired');
          }
          if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
          return data;
        });
    });
  }

  function formatDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function relativeTime(iso) {
    if (!iso) return 'never';
    var seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (!isFinite(seconds)) return 'never';
    if (seconds < 45) return 'just now';
    if (seconds < 90) return 'a minute ago';
    if (seconds < 3600) return Math.round(seconds / 60) + ' min ago';
    if (seconds < 7200) return 'an hour ago';
    if (seconds < 86400) return Math.round(seconds / 3600) + ' hours ago';
    if (seconds < 172800) return 'yesterday';
    return Math.round(seconds / 86400) + ' days ago';
  }

  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  // ------------------------------------------------------------ field HTML

  function present(value) {
    return String(value == null ? '' : value).trim().length > 0;
  }

  function setupItems() {
    var site = state.site || {};
    var brand = site.brand || {};
    var seo = site.seo || {};
    var home = site.home || {};
    var about = site.about || {};
    var links = (site.links && site.links.items) || [];
    var visibleLinks = links.filter(function (link) { return link && link.visible !== false && present(link.url); });
    var hasLink = function (pattern) { return visibleLinks.some(function (link) { return pattern.test(String(link.url || '')); }); };
    var realBio = (about.body || []).some(function (line) {
      return present(line) && !/write the real bio|new paragraph/i.test(line);
    });
    var usefulFaqs = (about.faqs || []).filter(function (item) {
      return item && item.visible !== false && present(item.question) && present(item.answer);
    });
    var credits = (about.credits || []).filter(function (item) { return item && item.visible !== false && present(item.title); });
    var quotes = (about.quotes || []).filter(function (item) { return item && present(item.text) && present(item.source); });
    var announcedShows = (site.shows || []).filter(function (item) { return item && item.visible !== false && present(item.date) && present(item.venue); });
    var undescribedPhotos = ((site.photos && site.photos.items) || []).filter(function (item) {
      return item && item.visible !== false && present(item.photo) && !present(item.photoAlt);
    });
    var reelsReady = Boolean((state.instagram && state.instagram.connected) || ((site.reels && site.reels.items) || []).some(function (item) {
      return item && item.visible !== false && (present(item.url) || present(item.video));
    }));

    return [
      { id: 'password', level: 'required', section: 'security', title: 'Replace the default admin password', done: !state.usingDefaultPassword,
        how: 'Open Security, enter the current password and a new private password, then choose Change password.' },
      { id: 'free-ai', level: 'optional', section: 'ai', title: 'Choose writing and photo providers', done: true,
        how: 'Open AI providers to add your own APIs and fallback order, or keep using free browser AI.' },
      { id: 'identity', level: 'required', section: 'brand', paths: ['brand.name', 'brand.accentLabel', 'brand.location'], title: 'Complete the public identity',
        done: present(brand.name) && present(brand.accentLabel) && present(brand.location),
        how: 'Open Brand & SEO. Enter the exact public name, the job title “Stand-up comedian,” and “New York City.” Keep this wording consistent everywhere.' },
      { id: 'booking', level: 'required', section: 'brand', paths: ['brand.email'], title: 'Add a working booking email', done: present(brand.email),
        how: 'Open Brand & SEO → Booking email. Enter the address that should receive professional enquiries, then send it a test message after saving.' },
      { id: 'search-copy', level: 'required', section: 'brand', paths: ['seo.title', 'seo.description'], title: 'Complete the search title and description',
        done: present(seo.title) && present(seo.description),
        how: 'Open Brand & SEO → Search & sharing. Put “Taylor Drew” and “New York City stand-up comedian” naturally in the title and description. Use Generate SEO + GEO if needed.' },
      { id: 'bio', level: 'required', section: 'about', paths: ['about.body.0'], title: 'Publish a real biography', done: realBio,
        how: 'Open About page → Bio. Add at least one factual paragraph covering who Taylor Drew is, where she performs, major credits and how to book her. Generate SEO + GEO, review it, then save.' },
      { id: 'hero-photo', level: 'required', section: 'home', paths: ['home.photo'], title: 'Choose the homepage photograph', done: present(home.photo),
        how: 'Open Home page → Hero photo → Choose or upload. Pick a sharp, recent photograph where Taylor Drew is clearly visible.' },
      { id: 'hero-alt', level: 'required', section: 'home', paths: ['home.photoAlt'], title: 'Describe the homepage photograph', done: !present(home.photo) || present(home.photoAlt),
        how: 'Open Home page → Hero photo and choose Generate photo SEO + GEO. Review the visible description, then save.' },
      { id: 'about-photo', level: 'recommended', section: 'about', paths: ['about.photo'], title: 'Add a separate About headshot', done: present(about.photo),
        how: 'Open About page → Photo → Choose or upload. Use a high-resolution headshot that is different from the homepage image.' },
      { id: 'about-alt', level: 'required', section: 'about', paths: ['about.photoAlt'], title: 'Describe the About headshot', done: !present(about.photo) || present(about.photoAlt),
        how: 'Open About page → Photo and choose Generate photo SEO + GEO. Review the description and save.' },
      { id: 'share-image', level: 'recommended', section: 'brand', paths: ['seo.ogImage'], title: 'Choose a social sharing image', done: present(seo.ogImage),
        how: 'Open Brand & SEO → Social share image. Upload a strong 1200 × 630 image, select it, then generate its photo SEO + GEO description.' },
      { id: 'share-alt', level: 'required', section: 'brand', paths: ['seo.ogImageAlt'], title: 'Describe the social sharing image', done: !present(seo.ogImage) || present(seo.ogImageAlt),
        how: 'Open Brand & SEO → Social share image and choose Generate photo SEO + GEO. Review the description and save.' },
      { id: 'favicon', level: 'recommended', section: 'brand', paths: ['seo.favicon'], title: 'Add the square app icon', done: present(seo.favicon),
        how: 'Open Brand & SEO → App icon. Upload and select a square PNG or WebP version of the Taylor Drew mark.' },
      { id: 'google', level: 'required', section: 'brand', paths: ['seo.googleVerification'], title: 'Verify Google Search Console', done: present(seo.googleVerification),
        how: 'Go to search.google.com/search-console, add taylordrew4u.com, choose the HTML tag method, copy the content value from google-site-verification, paste it here, save, then return to Google and press Verify.' },
      { id: 'bing', level: 'required', section: 'brand', paths: ['seo.bingVerification'], title: 'Verify Bing Webmaster Tools', done: present(seo.bingVerification),
        how: 'Go to bing.com/webmasters, add taylordrew4u.com, choose HTML meta tag verification, copy the msvalidate.01 content value, paste it here, save, then press Verify in Bing.' },
      { id: 'wikidata', level: 'recommended', section: 'brand', paths: ['seo.wikidata'], title: 'Connect the Wikidata identity', done: present(seo.wikidata),
        how: 'Open Brand & SEO → Wikidata item. Paste the verified Taylor Drew item’s Q number, such as Q123456, without creating a duplicate person.' },
      { id: 'instagram', level: 'required', section: 'links', title: 'Link the official Instagram profile', done: hasLink(/instagram\.com\/taylordrew4u/i),
        how: 'Open Links, add a visible link named Instagram, and use the full official profile URL: https://instagram.com/taylordrew4u.' },
      { id: 'imdb', level: 'recommended', section: 'links', title: 'Link the official IMDb profile', done: hasLink(/imdb\.com\/name\//i),
        how: 'Open Links, add a visible link named IMDb, and paste Taylor Drew’s exact imdb.com/name/ profile URL.' },
      { id: 'credits', level: 'recommended', section: 'about', title: 'Add selected credits and awards', done: credits.length > 0,
        how: 'Open About page → Selected credits. Add each verifiable credit separately, include the year and source link when available, and mark awards as awards.' },
      { id: 'faqs', level: 'recommended', section: 'about', title: 'Answer common questions', done: usefulFaqs.length >= 3,
        how: 'Open About page → Questions. Add at least three factual answers: who Taylor Drew is, where to see her live, and how to book her.' },
      { id: 'press', level: 'recommended', section: 'about', title: 'Add an attributed press quote', done: quotes.length > 0,
        how: 'Open About page → Press quotes. Paste an exact short quote and name the publication. Only use a quote that appears in a real source.' },
      { id: 'shows', level: 'recommended', section: 'shows', title: 'List every announced performance', done: announcedShows.length > 0,
        how: 'Open Shows and choose Add show, or post a flyer. Confirm the date, venue, city and ticket link before saving.' },
      { id: 'reels', level: 'recommended', section: 'reels', title: 'Connect or add performance clips', done: reelsReady,
        how: 'Open Reels. Connect the official Instagram account or add a visible reel with its permalink, cover image and factual description.' },
      { id: 'gallery-alt', level: 'required', section: 'photos', title: 'Describe every published gallery photo', done: undescribedPhotos.length === 0,
        how: 'Open Photos. For each published photo choose Generate photo SEO + GEO to write its image description, then add a title and caption. A photo with no description is left out of image search results and AI answers.' }
    ];
  }

  function missingSetupItems() {
    return setupItems().filter(function (item) { return !item.done; });
  }

  function setupForPath(path) {
    return missingSetupItems().filter(function (item) { return (item.paths || []).indexOf(path) !== -1; })[0] || null;
  }

  // A field that holds an exact fact but currently reads like a sentence. This
  // is what a generator, an import or a stray paste leaves behind, and it is
  // published verbatim into the structured data that tells search engines and
  // AI assistants who this is — so it is shown on the field, not buried.
  function identityNote(path, value) {
    var issue = window.CopyEditor.identityIssue(path || '', value);
    if (!issue) return '';
    return '<span class="field-warn"><strong>Check this:</strong> your structured data publishes this as ' +
      esc(issue.expects) + ', and it currently reads like a sentence. Search engines and AI assistants use it to work out who you are.' +
      (issue.suggestion
        ? ' <button class="btn btn-sm" type="button" data-action="identity-fix" data-target="' + esc(path) +
          '" data-value="' + esc(issue.suggestion) + '">Set to \u201c' + esc(issue.suggestion) + '\u201d</button>'
        : ' Shorten it by hand.') +
      '</span>';
  }

  function fieldSetupNote(path) {
    var item = setupForPath(path);
    return item
      ? '<span class="field-setup-note"><strong>' + (item.level === 'required' ? 'Required' : 'Recommended') + ':</strong> ' + esc(item.how) + '</span>'
      : '';
  }

  // Only editable copy gets a combined generator; exact facts stay intact.
  // What does not: identifiers and brand names (rewriting "Taylor Drew" is
  // never an improvement), links, addresses, dates, times, codes and keys.
  var recentRewrites = [];
  function seoEligible(opts) {
    if (opts.seo === false || (opts.type && opts.type !== 'text')) return false;
    if (!window.CopyEditor.fieldPolicy(opts.path || '')) return false;
    if (String(opts.value || '').trim() === String(state.site?.brand?.name || '').trim()) return false;
    return true;
  }

  // One request produces one version optimized for both search and AI answers.
  function seoButton(opts, compact) {
    if (!seoEligible(opts)) return '';
    return '<span class="search-generators' + (compact ? ' is-compact' : '') + '">' +
      '<button class="seo-generate" type="button" data-action="seo-generate" data-target="' + esc(opts.path) +
      '" data-label="' + esc(opts.label || 'Text') + '" title="Generate SEO + GEO" aria-label="Generate SEO + GEO for ' + esc(opts.label || 'this text') + '">' +
      (compact ? 'SEO + GEO' : 'Generate SEO + GEO') + '</button></span>';
  }

  function field(opts) {
    var value = opts.value == null ? '' : opts.value;
    var setup = setupForPath(opts.path);
    return (
      '<div class="field' + (setup ? ' is-needs-setup' : '') + '">' +
      '<label class="label" for="' + esc(opts.path) + '">' + esc(opts.label) + '</label>' +
      '<input class="input" id="' + esc(opts.path) + '" type="' + (opts.type || 'text') + '"' +
      ' data-path="' + esc(opts.path) + '"' +
      (opts.titleSource ? ' data-title-source="1"' : '') +
      (opts.attrs || '') +
      ' placeholder="' + esc(opts.placeholder || '') + '" value="' + esc(value) + '">' +
      seoButton(opts) +
      identityNote(opts.path, value) +
      fieldSetupNote(opts.path) +
      (opts.hint ? '<span class="hint">' + esc(opts.hint) + '</span>' : '') +
      '</div>'
    );
  }

  function textareaField(opts) {
    var setup = setupForPath(opts.path);
    return (
      '<div class="field' + (setup ? ' is-needs-setup' : '') + '">' +
      '<label class="label" for="' + esc(opts.path) + '">' + esc(opts.label) + '</label>' +
      '<textarea class="textarea" id="' + esc(opts.path) + '" data-path="' + esc(opts.path) + '"' +
      (opts.rows ? ' rows="' + opts.rows + '"' : '') +
      ' placeholder="' + esc(opts.placeholder || '') + '">' + esc(opts.value || '') + '</textarea>' +
      seoButton(opts) +
      identityNote(opts.path, opts.value) +
      fieldSetupNote(opts.path) +
      (opts.hint ? '<span class="hint">' + esc(opts.hint) + '</span>' : '') +
      '</div>'
    );
  }

  function toggleField(opts) {
    return (
      '<label class="switch"><input type="checkbox" data-path="' + esc(opts.path) + '"' +
      (opts.checked ? ' checked' : '') + (opts.rerender === false ? '' : ' data-rerender="1"') + '>' +
      '<span>' + esc(opts.label) + '</span></label>'
    );
  }

  function imageField(opts) {
    var value = opts.value || '';
    var setup = setupForPath(opts.path);
    return (
      '<div class="field' + (setup ? ' is-needs-setup' : '') + '">' +
      '<span class="label">' + esc(opts.label) + '</span>' +
      '<div class="image-field">' +
      '<span class="image-thumb"' + (value ? ' style="background-image:url(' + esc(value) + ')"' : '') + '>' +
      (value ? '' : 'No image') +
      '</span>' +
      '<span class="image-controls">' +
      '<input class="input" type="text" data-path="' + esc(opts.path) + '" data-image-input="1" placeholder="/uploads/photo.jpg" value="' + esc(value) + '">' +
      '<span class="image-buttons">' +
      '<button class="btn btn-sm" type="button" data-action="pick-image" data-target="' + esc(opts.path) + '">Choose or upload</button>' +
      (value && opts.seoTarget ? '<button class="btn btn-sm" type="button" data-action="seo-photo" data-target="' + esc(opts.seoTarget) + '" data-image-path="' + esc(opts.path) + '">Generate photo SEO + GEO</button>' : '') +
      (value ? '<button class="btn btn-sm btn-danger" type="button" data-action="clear-image" data-target="' + esc(opts.path) + '">Remove</button>' : '') +
      '</span>' +
      fieldSetupNote(opts.path) +
      (opts.hint ? '<span class="hint">' + esc(opts.hint) + '</span>' : '') +
      '</span></div></div>'
    );
  }

  function colorField(label, path, value) {
    return (
      '<div class="field">' +
      '<span class="label">' + esc(label) + '</span>' +
      '<span class="color-field">' +
      '<input type="color" data-path="' + esc(path) + '" data-color-sync="1" value="' + esc(value) + '">' +
      '<input class="input" type="text" data-path="' + esc(path) + '" data-color-text="1" value="' + esc(value) + '">' +
      '</span></div>'
    );
  }

  function card(title, bodyHtml, opts) {
    opts = opts || {};
    return (
      '<section class="card">' +
      '<header class="card-head"><div><h2>' + esc(title) + '</h2>' +
      (opts.subtitle ? '<p>' + esc(opts.subtitle) + '</p>' : '') +
      '</div>' +
      (opts.actions ? '<div class="card-actions">' + opts.actions + '</div>' : '') +
      '</header>' +
      '<div class="card-body">' + bodyHtml + '</div></section>'
    );
  }

  function repeatItem(opts) {
    return (
      '<article class="repeat-item" draggable="true" data-sortable-item data-list="' + esc(opts.list) + '" data-index="' + opts.index + '">' +
      '<header class="repeat-head">' +
      '<span class="drag-handle" title="Drag to reorder">⠿</span>' +
      '<span class="repeat-title">' + esc(opts.title || 'Untitled') + '</span>' +
      (opts.badges || []).map(function (b) {
        return '<span class="repeat-badge ' + esc(b.cls || '') + '">' + esc(b.text) + '</span>';
      }).join('') +
      '<span class="repeat-tools">' +
      '<button class="btn btn-sm" type="button" data-action="list-move" data-list="' + esc(opts.list) + '" data-index="' + opts.index + '" data-dir="-1" title="Move up">↑</button>' +
      '<button class="btn btn-sm" type="button" data-action="list-move" data-list="' + esc(opts.list) + '" data-index="' + opts.index + '" data-dir="1" title="Move down">↓</button>' +
      '<button class="btn btn-sm btn-danger" type="button" data-action="list-remove" data-list="' + esc(opts.list) + '" data-index="' + opts.index + '" title="Delete">✕</button>' +
      '</span></header>' +
      '<div class="repeat-body">' + opts.body + '</div></article>'
    );
  }

  function emptyState(message) {
    return '<p class="empty">' + esc(message) + '</p>';
  }

  // ------------------------------------------------------------- sections

  function sectionOverview() {
    var s = state.stats || {};
    var site = state.site;
    var allSetup = setupItems();
    var missingSetup = allSetup.filter(function (item) { return !item.done; });
    var requiredMissing = missingSetup.filter(function (item) { return item.level === 'required'; }).length;
    var setupRows = missingSetup.length
      ? missingSetup.map(function (item) {
          return '<article class="setup-item is-' + esc(item.level) + '">' +
            '<div class="setup-copy"><span class="setup-level">' + (item.level === 'required' ? 'Required' : 'Recommended') + '</span>' +
            '<strong>' + esc(item.title) + '</strong><p>' + esc(item.how) + '</p></div>' +
            '<button class="btn btn-sm" type="button" data-action="goto" data-section="' + esc(item.section) + '">Open ' +
            esc((SECTIONS.filter(function (section) { return section.id === item.section; })[0] || {}).label || item.section) + '</button></article>';
        }).join('')
      : '<div class="setup-complete"><strong>Everything is filled out.</strong><p>No required or recommended setup items are missing.</p></div>';
    var maxClicks = Math.max.apply(
      null,
      [1].concat((s.topLinks || []).map(function (l) {
        return l.clicks;
      }))
    );

    var warning = state.usingDefaultPassword
      ? '<div class="notice"><div><strong>You are still using the default password.</strong>' +
        'Anyone who knows it can edit the site. Set your own in Security.</div>' +
        '<button class="btn btn-sm" type="button" data-action="goto" data-section="security">Change it</button></div>'
      : '';

    var stats = [
      { value: s.linksVisible + ' / ' + s.links, label: 'Links live' },
      { value: s.clicks, label: 'Link clicks' },
      { value: s.upcomingShows, label: 'Upcoming shows' },
      { value: s.uploads, label: 'Images' }
    ]
      .map(function (item) {
        return '<div class="stat"><div class="stat-value">' + esc(item.value) + '</div><div class="stat-label">' + esc(item.label) + '</div></div>';
      })
      .join('');

    var clickRows = (s.topLinks || []).length
      ? s.topLinks
          .map(function (link) {
            return (
              '<div class="bar-row"><span class="bar-label">' + esc(link.label) + '</span>' +
              '<span class="bar-track"><span class="bar-fill" style="width:' + Math.round((link.clicks / maxClicks) * 100) + '%"></span></span>' +
              '<span class="bar-value">' + esc(link.clicks) + '</span></div>'
            );
          })
          .join('')
      : emptyState('No clicks recorded yet.');

    var quick = [
      ['home', 'Edit the hero'],
      ['links', 'Manage links'],
      ['shows', 'Add a show'],
      ['media', 'Upload a photo'],
      ['themes', 'Change colours']
    ]
      .map(function (pair) {
        return '<button class="btn btn-sm" type="button" data-action="goto" data-section="' + pair[0] + '">' + esc(pair[1]) + '</button>';
      })
      .join(' ');

    return (
      warning +
      card(
        'Finish setting up the site',
        '<div class="setup-summary"><strong>' + esc(allSetup.length - missingSetup.length) + ' of ' + esc(allSetup.length) + ' complete</strong>' +
          '<span>' + (requiredMissing ? esc(requiredMissing) + ' required item' + (requiredMissing === 1 ? '' : 's') + ' left' : 'No required items left') + '</span></div>' +
          '<div class="setup-list">' + setupRows + '</div>',
        { subtitle: 'Anything missing is listed here with exact instructions and marked again inside its section.' }
      ) +
      '<div class="stat-grid">' + stats + '</div>' +
      card('Quick actions', '<div class="image-buttons">' + quick + '</div>') +
      card('Most clicked links', clickRows, {
        subtitle: 'Counted when a visitor follows a link from the links page.',
        actions: '<button class="btn btn-sm btn-danger" type="button" data-action="reset-analytics">Reset counts</button>'
      }) +
      card(
        'Site status',
        '<table class="table"><tbody>' +
          '<tr><th>Site title</th><td>' + esc(site.seo.title) + '</td></tr>' +
          '<tr><th>Default theme</th><td>' + esc(site.themes.default) + '</td></tr>' +
          '<tr><th>Pages</th><td>' + esc(site.nav.filter(function (n) { return n.visible !== false; }).length) + ' in the menu</td></tr>' +
          '<tr><th>Last saved</th><td>' + esc(formatDate(s.updatedAt)) + '</td></tr>' +
          (state.storage ? '<tr><th>Storage</th><td>' + esc(state.storage) + '</td></tr>' : '') +
          '</tbody></table>'
      )
    );
  }

  function sectionBrand() {
    var site = state.site;
    return (
      card(
        'Brand',
        '<div class="grid-2">' +
          field({ label: 'Name', path: 'brand.name', value: site.brand.name }) +
          field({ label: 'Logo text (header)', path: 'brand.logoText', value: site.brand.logoText, hint: 'Shown top-left on every page.' }) +
          field({ label: 'Location', path: 'brand.location', value: site.brand.location }) +
          field({ label: 'Booking email', path: 'brand.email', value: site.brand.email }) +
          field({
            label: 'Gender',
            path: 'brand.gender',
            value: site.brand.gender,
            placeholder: 'Female',
            hint: 'Optional, and only used in the structured data. It is what lets a search or an AI answer match you to a question like “female comedians in New York” instead of guessing from pronouns.'
          }) +
          '</div>'
      ) +
      card(
        'Search & sharing',
        field({ label: 'Page title', path: 'seo.title', value: site.seo.title, hint: 'Shown in the browser tab and in Google results.' }) +
          textareaField({ label: 'Description', path: 'seo.description', value: site.seo.description, rows: 3, hint: 'Around 150 characters works best.' }) +
          '<div class="grid-2">' +
          imageField({ label: 'Social share image', path: 'seo.ogImage', value: site.seo.ogImage, seoTarget: 'seo.ogImageAlt', hint: 'What shows when someone pastes your link. 1200 × 630 is ideal.' }) +
          imageField({
            label: 'App icon',
            path: 'seo.favicon',
            value: site.seo.favicon,
            hint: 'Square. Used on phone home screens and bookmarks. The browser tab gets a drawn “' +
              esc(brandInitials(site)) +
              '” instead — at 16 pixels a wordmark or a face is unreadable.'
          }) +
          '</div>' +
          field({
            label: 'Share image alt text',
            path: 'seo.ogImageAlt',
            value: site.seo.ogImageAlt,
            placeholder: 'Taylor Drew logo — torn paper lettering',
            hint: 'Describes the share image for screen readers and image search.'
          })
      ) +
      card(
        'Verify with search engines',
        '<div class="grid-2">' +
          field({
            label: 'Google Search Console',
            path: 'seo.googleVerification',
            value: site.seo.googleVerification,
            placeholder: 'google-site-verification code',
            hint: 'Paste the code — or the whole meta tag — from Search Console’s HTML tag method, then press Verify there.'
          }) +
          field({
            label: 'Bing Webmaster Tools',
            path: 'seo.bingVerification',
            value: site.seo.bingVerification,
            placeholder: 'msvalidate.01 code',
            hint: 'Bing feeds Copilot and ChatGPT search, so this one is worth doing too.'
          }) +
          '</div>',
        {
          subtitle:
            'Verifying proves the site is yours. It is how you submit the sitemap, ask for a page to be re-crawled the day you change it, and see what people searched to find you.'
        }
      ) +
      card(
        'Wikidata item',
        field({
          label: 'Item ID',
          path: 'seo.wikidata',
          value: site.seo.wikidata,
          placeholder: 'Q141283452',
          hint: 'The Q number, or paste the whole wikidata.org address — either works.'
        }),
        {
          subtitle:
            'Wikidata is the record Google’s knowledge panel and the AI answer engines are built from. Naming your item here is what turns a site that describes you into a site that resolves to a known person.'
        }
      )
    );
  }

  /** Mirrors the initials the server draws into the tab icon. */
  function brandInitials(site) {
    var parts = String(site.brand.logoText || site.brand.name || '')
      .trim()
      .split(/\s+/)
      .filter(function (w) { return /[a-z0-9]/i.test(w); });
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function sectionHome() {
    var home = state.site.home;
    return (
      card(
        'Hero',
        field({ label: 'Kicker', path: 'home.kicker', value: home.kicker, hint: 'Small line above the name.' }) +
          field({ label: 'Big headline', path: 'home.headline', value: home.headline, hint: 'Each word stacks on its own line.' }) +
          field({ label: 'Subhead', path: 'home.subhead', value: home.subhead }) +
          imageField({ label: 'Hero photo', path: 'home.photo', value: home.photo, seoTarget: 'home.photoAlt' }) +
          '<div class="grid-2">' +
          field({ label: 'Photo alt text', path: 'home.photoAlt', value: home.photoAlt, hint: 'Described for screen readers.' }) +
          field({ label: 'Empty photo placeholder', path: 'home.photoPlaceholder', value: home.photoPlaceholder }) +
          '</div>'
      ) +
      card(
        'Buttons',
        '<div class="grid-2">' +
          '<div>' +
          field({ label: 'Primary button label', path: 'home.primaryCta.label', value: home.primaryCta.label }) +
          field({ label: 'Primary button link', path: 'home.primaryCta.href', value: home.primaryCta.href }) +
          toggleField({ label: 'Show primary button', path: 'home.primaryCta.visible', checked: home.primaryCta.visible }) +
          '</div><div>' +
          field({ label: 'Secondary button label', path: 'home.secondaryCta.label', value: home.secondaryCta.label }) +
          field({ label: 'Secondary button link', path: 'home.secondaryCta.href', value: home.secondaryCta.href }) +
          toggleField({ label: 'Show secondary button', path: 'home.secondaryCta.visible', checked: home.secondaryCta.visible }) +
          '</div></div>'
      ) +
      card(
        'Upcoming block',
        '<div class="grid-2">' +
          field({ label: 'Heading', path: 'home.upcoming.label', value: home.upcoming.label }) +
          field({ label: 'Text when there are no shows', path: 'home.upcoming.emptyText', value: home.upcoming.emptyText, hint: 'Each word stacks on its own line.' }) +
          field({ label: 'How many shows to list', path: 'home.upcoming.maxItems', value: home.upcoming.maxItems, type: 'number', attrs: ' min="1" max="12"' }) +
          '</div>' +
          toggleField({ label: 'Show the upcoming block', path: 'home.upcoming.visible', checked: home.upcoming.visible }),
        { subtitle: 'Dates come from the Shows section.' }
      )
    );
  }

  function sectionLinks() {
    var links = state.site.links;
    var items = links.items || [];
    var live = items.filter(function (l) {
      return l.visible !== false;
    });
    var totalClicks = items.reduce(function (sum, l) {
      return sum + (Number(l.clicks) || 0);
    }, 0);
    var top = items.slice().sort(function (a, b) {
      return (Number(b.clicks) || 0) - (Number(a.clicks) || 0);
    })[0];

    var stats =
      '<div class="stat-grid">' +
      [
        { value: live.length + ' / ' + items.length, label: 'Live' },
        { value: totalClicks, label: 'Clicks' },
        {
          value: top && top.clicks ? top.clicks : '—',
          label: top && top.clicks ? 'Most clicked · ' + top.label : 'No clicks yet'
        },
        { value: items.filter(function (l) { return l.featured; }).length, label: 'Featured' }
      ]
        .map(function (item) {
          return (
            '<div class="stat"><div class="stat-value">' + esc(item.value) + '</div>' +
            '<div class="stat-label">' + esc(item.label) + '</div></div>'
          );
        })
        .join('') +
      '</div>';

    var header =
      '<div class="dtable-row dtable-head">' +
      '<span></span><span>Label</span><span>Sub-label</span><span>URL</span>' +
      '<span>Clicks</span><span>Feat</span><span>Live</span><span></span>' +
      '</div>';

    var table = items.length
      ? '<div class="dtable-scroll"><div class="dtable dtable-links" data-sortable="links.items">' +
        header +
        items
          .map(function (item, i) {
            return (
              '<div class="dtable-row' + (item.visible === false ? ' is-off' : '') +
              (item.featured ? ' is-featured' : '') +
              '" data-sortable-item data-list="links.items" data-index="' + i + '" draggable="true">' +
              '<span class="drag-handle" title="Drag to reorder">⠿</span>' +
              cell('label', 'links.items.' + i + '.label', item.label, 'Label', 'text', 'Instagram') +
              cell('sublabel', 'links.items.' + i + '.sublabel', item.sublabel, 'Sub-label', 'text', 'Clips and day-to-day') +
              cell('linkurl', 'links.items.' + i + '.url', item.url, 'URL', 'text', 'https://…') +
              '<span class="cell-clicks" title="Clicks counted when a visitor follows this link">' +
              esc(Number(item.clicks) || 0) + '</span>' +
              miniToggle('links.items.' + i + '.featured', !!item.featured, 'Featured') +
              miniToggle('links.items.' + i + '.visible', item.visible !== false, 'Visible on the site', 'Live') +
              '<span class="row-tools">' +
              reorderButtons('links.items', i) +
              '<button class="icon-btn icon-btn-sm btn-danger" type="button" data-action="list-remove" data-list="links.items" data-index="' + i + '" title="Delete">✕</button>' +
              '</span>' +
              '</div>'
            );
          })
          .join('') +
        '</div></div>'
      : emptyState('No links yet — add the first one.');

    return (
      stats +
      card('Links', table, {
        subtitle: 'Drag to reorder. Featured links get the accent bar on the links page.',
        actions:
          '<button class="btn btn-sm" type="button" data-action="sort-links" title="Order by clicks, most first">Sort by clicks</button>' +
          '<button class="btn btn-sm btn-accent" type="button" data-action="list-add" data-list="links.items">Add link</button>'
      }) +
      card(
        'Page header',
        '<div class="grid-2">' +
          field({ label: 'Kicker', path: 'links.kicker', value: links.kicker }) +
          field({ label: 'Title', path: 'links.title', value: links.title }) +
          '</div>' +
          textareaField({ label: 'Intro', path: 'links.intro', value: links.intro, rows: 2 }),
        { subtitle: 'The wording above the list on the public links page.' }
      )
    );
  }

  function sectionShows() {
    var shows = state.site.shows || [];
    var today = new Date().toISOString().slice(0, 10);
    var filter = state.showFilter || 'all';
    var isPast = function (show) {
      return show.date && show.date < today;
    };

    // Rows carry their original index, so filtering never rewrites a data-path.
    var rows = shows
      .map(function (show, index) {
        return { show: show, index: index };
      })
      .filter(function (row) {
        if (filter === 'upcoming') return !isPast(row.show);
        if (filter === 'past') return isPast(row.show);
        return true;
      });

    var live = shows.filter(function (s) {
      return s.visible !== false;
    });
    var upcoming = live.filter(function (s) {
      return !isPast(s);
    });
    var next = upcoming
      .slice()
      .sort(function (a, b) {
        return String(a.date || '9999').localeCompare(String(b.date || '9999'));
      })[0];

    var stats =
      '<div class="stat-grid">' +
      [
        { value: upcoming.length, label: 'Live upcoming' },
        {
          value: next ? (next.date ? formatShortDate(next.date) : 'TBA') : '—',
          label: next ? (next.venue || 'Next show').slice(0, 24) : 'Nothing booked',
          small: true
        },
        { value: shows.filter(isPast).length, label: 'Past' },
        { value: shows.length - live.length, label: 'Hidden' }
      ]
        .map(function (item) {
          return (
            '<div class="stat"><div class="stat-value' + (item.small ? ' stat-value-sm' : '') + '">' +
            esc(item.value) + '</div><div class="stat-label">' + esc(item.label) + '</div></div>'
          );
        })
        .join('') +
      '</div>';

    var filters = [
      { id: 'all', label: 'All', count: shows.length },
      { id: 'upcoming', label: 'Upcoming', count: shows.filter(function (s) { return !isPast(s); }).length },
      { id: 'past', label: 'Past', count: shows.filter(isPast).length }
    ]
      .map(function (f) {
        return (
          '<button class="chip' + (filter === f.id ? ' is-active' : '') + '" type="button" ' +
          'data-action="show-filter" data-filter="' + f.id + '">' + esc(f.label) +
          '<span class="chip-count">' + f.count + '</span></button>'
        );
      })
      .join('');

    var header =
      '<div class="dtable-row dtable-head">' +
      '<span></span><span>Date</span><span>Time</span><span>Venue</span><span>City</span>' +
      '<span>Ticket link</span><span>Sold</span><span>Live</span><span></span>' +
      '</div>';

    var body = shows.length
      ? (rows.length
          ? '<div class="dtable-scroll"><div class="dtable dtable-shows" data-sortable="shows">' + header +
            rows
              .map(function (row) {
                var show = row.show;
                var i = row.index;
                var open = (state.expandedShows || {})[show.id];
                return (
                  '<div class="dtable-row' + (isPast(show) ? ' is-past' : '') +
                  (show.visible === false ? ' is-off' : '') + (open ? ' is-open' : '') +
                  '" data-sortable-item data-list="shows" data-index="' + i + '" draggable="true">' +
                  '<span class="drag-handle" title="Drag to reorder">⠿</span>' +
                  cell('date', 'shows.' + i + '.date', show.date, 'Date', 'date') +
                  cell('time', 'shows.' + i + '.time', show.time, 'Time', 'text', '8:00 PM') +
                  cell('venue', 'shows.' + i + '.venue', show.venue, 'Venue', 'text', 'Venue name') +
                  cell('city', 'shows.' + i + '.city', show.city, 'City', 'text', 'City, ST') +
                  cell('url', 'shows.' + i + '.url', show.url, 'Ticket link', 'text', 'https://…') +
                  miniToggle('shows.' + i + '.soldOut', !!show.soldOut, 'Sold out') +
                  miniToggle('shows.' + i + '.visible', show.visible !== false, 'Visible on the site', 'Live') +
                  '<span class="row-tools">' +
                  reorderButtons('shows', i) +
                  '<button class="icon-btn icon-btn-sm" type="button" data-action="toggle-show" data-id="' + esc(show.id) + '" title="More" aria-expanded="' + (open ? 'true' : 'false') + '">' + (open ? '−' : '+') + '</button>' +
                  '<button class="icon-btn icon-btn-sm btn-danger" type="button" data-action="list-remove" data-list="shows" data-index="' + i + '" title="Delete">✕</button>' +
                  '</span>' +
                  (open
                    ? '<div class="dtable-extra">' +
                      miniField('Button label', 'shows.' + i + '.ctaLabel', show.ctaLabel, 'Tickets') +
                      miniField('Note', 'shows.' + i + '.note', show.note, 'Late show · 18+', true) +
                      miniField('Venue street address', 'shows.' + i + '.street', show.street, '117 MacDougal St', true) +
                      miniField('Postal code', 'shows.' + i + '.postalCode', show.postalCode, '10012') +
                      miniField('Country', 'shows.' + i + '.country', show.country, 'US') +
                      '<div class="mini-field mini-field-wide">' +
                      field({ label: 'Flyer description', path: 'shows.' + i + '.flyerAlt', value: show.flyerAlt, seo: false }) +
                      imageField({ label: 'Flyer', path: 'shows.' + i + '.flyer', value: show.flyer, seoTarget: 'shows.' + i + '.flyerAlt', hint: 'Shown beside the date on the links page and published as the event’s picture.' }) +
                      '</div>' +
                      '</div>'
                    : '') +
                  '</div>'
                );
              })
              .join('') +
            '</div></div>'
          : emptyState('Nothing in this view. Try another filter.'))
      : emptyState('No dates yet. The home page shows your “coming soon” text until there are some.');

    return (
      flyerCard() +
      stats +
      card('Tour dates', body, {
        subtitle: 'Past dates leave the home page on their own and move to the bottom of the links page. Open a row (+) to add the venue’s street address — a full address is what Google’s event listings actually want.',
        actions:
          '<div class="chips">' + filters + '</div>' +
          '<button class="btn btn-sm" type="button" data-action="sort-shows" title="Order by date, soonest first">Sort by date</button>' +
          '<button class="btn btn-sm btn-accent" type="button" data-action="list-add" data-list="shows">Add show</button>'
      })
    );
  }

  // Read images locally with the free browser vision model.
  function flyerCard() {
    var body = state.flyerBusy
      ? '<div class="upload-drop flyer-drop is-busy" aria-busy="true"><span class="flyer-spinner" aria-hidden="true"></span><span>Reading the flyer…</span><small id="flyer-ai-progress">Preparing your selected AI provider…</small></div>'
      : '<label class="upload-drop flyer-drop" data-flyer-drop="1"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden data-flyer-input="1"><span>Drop a flyer here or click to post one</span><small>AI reads the date, venue and ticket details. Review before saving.</small></label>';
    body += '<p class="hint">Uses your selected AI mode. Add image-capable API providers under AI providers, or use the free browser vision model. Review the extracted details before saving.</p>';
    return card('Post a flyer', body, { subtitle: 'Read a flyer with your selected AI mode, then review the show details.' });
  }

  function freeImageGeneration(imageUrl, prompt, schema, onProgress) {
    return Promise.resolve().then(function () {
      return generateAI({ vision: true, schema: schema, onProgress: onProgress,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: prompt }
        ] }]
      });
    });
  }

  function postFlyer(file) {
    if (!file || !/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) {
      return toast('A flyer has to be a PNG, JPG, WebP or GIF image.', 'error');
    }
    state.flyerBusy = true;
    render({ preserveFocus: false });
    prepareImage(file)
      .then(function (prepared) {
        var properties = {};
        ['title', 'date', 'time', 'venue', 'city', 'street', 'postalCode', 'country', 'url', 'note', 'confidence'].forEach(function (key) { properties[key] = { type: 'string' }; });
        properties.missing = { type: 'array', items: { type: 'string' } };
        properties.soldOut = { type: 'boolean' };
        return freeImageGeneration(prepared.dataUrl,
          'Read this show flyer. Today is ' + new Date().toISOString().slice(0, 10) + '. Return JSON with the printed title, date (YYYY-MM-DD), time, venue, city, street, postalCode, country, ticket url, note, soldOut, confidence and missing field names. Use empty strings for unclear details. Never invent an event, place, date, year or link; if the year is absent leave date empty for review. Confidence is high, medium or low.',
          { type: 'object', properties: properties, required: Object.keys(properties) },
          function (message) { var progress = document.getElementById('flyer-ai-progress'); if (progress) progress.textContent = String(message); }
        ).then(function (details) {
          return api('/admin/shows/flyer', { method: 'POST', body: { name: file.name, dataUrl: prepared.dataUrl, details: details } });
        });
      })
      .then(function (data) {
        state.flyerBusy = false;
        var show = data.show;
        state.site.shows = state.site.shows || [];
        state.site.shows.push(show);
        state.expandedShows[show.id] = true;
        state.showFilter = 'all';
        markDirty();
        loadMedia().catch(function () {});
        var missing = (data.missing || []).filter(function (m) {
          return m === 'date' || m === 'venue';
        });
        var label = [show.venue, show.date].filter(Boolean).join(' · ') || 'a show';
        if (missing.length) {
          render({ preserveFocus: false });
          scrollToShow(show.id);
          return toast('Added ' + label + ' — could not read the ' + missing.join(' or ') + ', fill it in and save.', 'info');
        }
        render({ preserveFocus: false });
        scrollToShow(show.id);
        toast('Added ' + label + ' — review the details, then save to publish.', 'ok');
      })
      .catch(function (err) {
        state.flyerBusy = false;
        render({ preserveFocus: false });
        toast(err.message || 'Could not read the flyer.', 'error');
      });
  }

  function scrollToShow(id) {
    var button = el.panel.querySelector('[data-action="toggle-show"][data-id="' + id.replace(/"/g, '\\"') + '"]');
    var row = button && button.closest('.dtable-row');
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // Touch screens never fire the drag events the reorder handle relies on, so
  // narrow layouts get buttons instead. Hidden by CSS wherever dragging works.
  function reorderButtons(list, index) {
    return [-1, 1]
      .map(function (dir) {
        return (
          '<button class="icon-btn icon-btn-sm reorder-btn" type="button" data-action="list-move"' +
          ' data-list="' + esc(list) + '" data-index="' + index + '" data-dir="' + dir + '"' +
          ' title="Move ' + (dir < 0 ? 'up' : 'down') + '">' + (dir < 0 ? '\u2191' : '\u2193') + '</button>'
        );
      })
      .join('');
  }

  // The wrapper carries the column name so a stacked phone row can show it.
  // Wide enough for the header strip, the name is hidden and the header labels.
  function cell(kind, path, value, label, type, placeholder) {
    return (
      '<label class="cell cell-' + kind + '"><span class="cell-name">' + esc(label) + '</span>' +
      '<input class="input input-sm" type="' + (type || 'text') + '" data-path="' + esc(path) + '"' +
      ' aria-label="' + esc(label) + '" placeholder="' + esc(placeholder || '') + '" value="' + esc(value || '') + '">' +
      seoButton({ path: path, label: label, type: type || 'text' }, true) +
      '</label>'
    );
  }

  // The small labelled inputs inside an opened show row. Text that reaches
  // the site (the note, the button label) gets the compact generator pair.
  function miniField(label, path, value, placeholder, wide) {
    return (
      '<label class="mini-field' + (wide ? ' mini-field-wide' : '') + '"><span>' + esc(label) + '</span>' +
      '<input class="input input-sm" type="text" data-path="' + esc(path) + '" value="' + esc(value || '') + '" placeholder="' + esc(placeholder || '') + '">' +
      seoButton({ path: path, label: label, type: 'text' }, true) +
      '</label>'
    );
  }

  // `short` is the caption a stacked phone row shows beside the switch; the
  // screen-reader name stays the longer, fuller `label`.
  function miniToggle(path, checked, label, short) {
    return (
      '<label class="switch switch-mini" title="' + esc(label) + '">' +
      '<input type="checkbox" data-path="' + esc(path) + '" data-rerender="1"' + (checked ? ' checked' : '') + '>' +
      '<span class="sr-only">' + esc(label) + '</span>' +
      '<span class="switch-name" aria-hidden="true">' + esc(short || label) + '</span></label>'
    );
  }

  function formatShortDate(iso) {
    var d = new Date(iso + 'T12:00:00Z');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function sectionAbout() {
    var about = state.site.about;
    var paragraphs = (about.body || []).length
      ? '<div class="repeat-list" data-sortable="about.body">' +
        about.body
          .map(function (p, i) {
            return repeatItem({
              list: 'about.body',
              index: i,
              title: 'Paragraph ' + (i + 1),
              body: textareaField({ label: 'Text', path: 'about.body.' + i, value: p, rows: 4 })
            });
          })
          .join('') +
        '</div>'
      : emptyState('No bio yet.');

    var facts = (about.facts || []).length
      ? '<div class="repeat-list" data-sortable="about.facts">' +
        about.facts
          .map(function (f, i) {
            return repeatItem({
              list: 'about.facts',
              index: i,
              title: f.label || 'Fact',
              body:
                '<div class="grid-2">' +
                field({ label: 'Label', path: 'about.facts.' + i + '.label', value: f.label, titleSource: true }) +
                field({ label: 'Value', path: 'about.facts.' + i + '.value', value: f.value }) +
                '</div>'
            });
          })
          .join('') +
        '</div>'
      : emptyState('No facts listed.');

    var credits = (about.credits || []).length
      ? '<div class="repeat-list" data-sortable="about.credits">' +
        about.credits
          .map(function (c, i) {
            var base = 'about.credits.' + i;
            return repeatItem({
              list: 'about.credits',
              index: i,
              title: c.title || 'Credit',
              body:
                '<div class="grid-2">' +
                field({ label: 'Title', path: base + '.title', value: c.title, titleSource: true, placeholder: 'Orange Is the New Black' }) +
                field({ label: 'Detail', path: base + '.detail', value: c.detail, placeholder: 'Best Writer, Alternative Film Festival' }) +
                '</div>' +
                '<div class="grid-2">' +
                field({ label: 'Year', path: base + '.year', value: c.year, placeholder: '2025' }) +
                field({ label: 'Link', path: base + '.url', value: c.url, placeholder: 'https://…', hint: 'Optional. IMDb, a festival page, the film itself.' }) +
                '</div>' +
                '<div class="row-switches">' +
                toggleField({ label: 'This is an award', path: base + '.award', checked: !!c.award }) +
                toggleField({ label: 'Show on the site', path: base + '.visible', checked: c.visible !== false }) +
                '</div>'
            });
          })
          .join('') +
        '</div>'
      : emptyState('No credits yet — add the ones worth naming.');

    var quotes = (about.quotes || []).length
      ? '<div class="repeat-list" data-sortable="about.quotes">' +
        about.quotes
          .map(function (q, i) {
            return repeatItem({
              list: 'about.quotes',
              index: i,
              title: q.source || 'Quote',
              body:
                textareaField({ label: 'Quote', path: 'about.quotes.' + i + '.text', value: q.text, rows: 3 }) +
                field({ label: 'Source', path: 'about.quotes.' + i + '.source', value: q.source, titleSource: true })
            });
          })
          .join('') +
        '</div>'
      : emptyState('No press quotes yet.');

    var faqs = (about.faqs || []).length
      ? '<div class="repeat-list" data-sortable="about.faqs">' +
        about.faqs
          .map(function (f, i) {
            var base = 'about.faqs.' + i;
            return repeatItem({
              list: 'about.faqs',
              index: i,
              title: f.question || 'Question',
              body:
                field({
                  label: 'Question',
                  path: base + '.question',
                  value: f.question,
                  titleSource: true,
                  placeholder: 'Where can I see Taylor Drew live?'
                }) +
                textareaField({ label: 'Answer', path: base + '.answer', value: f.answer, rows: 3 }) +
                '<div class="row-switches">' +
                toggleField({ label: 'Show on the site', path: base + '.visible', checked: f.visible !== false }) +
                '</div>'
            });
          })
          .join('') +
        '</div>'
      : emptyState('No questions yet.');

    return (
      card(
        'Header',
        '<div class="grid-2">' +
          field({ label: 'Kicker', path: 'about.kicker', value: about.kicker }) +
          field({ label: 'Title', path: 'about.title', value: about.title, hint: 'Each word stacks on its own line.' }) +
          '</div>' +
          imageField({ label: 'Photo', path: 'about.photo', value: about.photo, seoTarget: 'about.photoAlt' }) +
          field({ label: 'Photo alt text', path: 'about.photoAlt', value: about.photoAlt })
      ) +
      card('Bio', paragraphs, {
        actions: '<button class="btn btn-sm btn-accent" type="button" data-action="list-add" data-list="about.body">Add paragraph</button>'
      }) +
      card('Facts', facts, {
        subtitle: 'Small label / value pairs beside the bio.',
        actions: '<button class="btn btn-sm btn-accent" type="button" data-action="list-add" data-list="about.facts">Add fact</button>'
      }) +
      card(
        'Credits & awards',
        field({
          label: 'Section heading',
          path: 'about.creditsLabel',
          value: about.creditsLabel,
          placeholder: 'Selected credits'
        }) + credits,
        {
          subtitle:
            'Listed on the about page, and published as structured data so search and answer engines can attribute them to you. Mark the awards — they are the part that carries weight.',
          actions:
            '<button class="btn btn-sm btn-accent" type="button" data-action="list-add" data-list="about.credits">Add credit</button>'
        }
      ) +
      card('Press quotes', quotes, {
        actions: '<button class="btn btn-sm btn-accent" type="button" data-action="list-add" data-list="about.quotes">Add quote</button>'
      }) +
      card(
        'Questions',
        field({
          label: 'Section heading',
          path: 'about.faqLabel',
          value: about.faqLabel,
          placeholder: 'Questions'
        }) + faqs,
        {
          subtitle:
            'The questions people ask, answered in your words. These go on the about page, into /llms.txt, and out as structured data — so when someone asks ChatGPT or Google who you are, the answer it repeats is this one rather than a guess.',
          actions:
            '<button class="btn btn-sm btn-accent" type="button" data-action="list-add" data-list="about.faqs">Add question</button>'
        }
      )
    );
  }

  /** Whether the deployment can read the account, in plain words. */
  function igStatus() {
    var ig = state.instagram;
    if (!ig) return '<p class="hint">Checking…</p>';

    if (ig.connected) {
      var until = ig.expiresAt ? new Date(ig.expiresAt) : null;
      var days = until ? Math.round((until - new Date()) / 86400000) : null;
      return (
        '<p class="hint"><strong>Connected' + (ig.username ? ' as @' + esc(ig.username) : '') +
        '.</strong> The wall is rebuilt from your account every 20 minutes.' +
        (days !== null
          ? ' The access token renews itself automatically; as it stands it is good for another ' +
            days + ' day' + (days === 1 ? '' : 's') + '.'
          : '') +
        '</p>' +
        '<p class="hint">If Instagram is ever unreachable, /reels keeps showing the last good wall for a day, ' +
        'then falls back to the pinned reels below.</p>' +
        igMessageForm(ig) +
        '<button class="btn btn-sm btn-danger" type="button" data-action="ig-disconnect">Disconnect</button>'
      );
    }

    if (ig.canConnect) {
      return (
        '<p class="hint">Not connected — /reels shows only the pinned reels below.</p>' +
        '<p><a class="btn btn-sm btn-accent" href="' + esc(ig.authorizeUrl) + '">Connect Instagram</a></p>' +
        '<p class="hint">Opens Instagram, asks for read access to your reels, and brings you back here. ' +
        'The redirect URI registered with your Meta app must be exactly <code>' + esc(ig.redirectUri) + '</code>.</p>' +
        igTokenForm() +
        '<details class="ig-details"><summary>App details</summary>' + igAppForm(ig) + '</details>'
      );
    }

    return (
      '<p class="hint">Not connected — /reels shows only the pinned reels below.</p>' +
      igTokenForm() +
      igAppForm(ig)
    );
  }

  /**
   * A token minted somewhere else — Meta's dashboard hands one out directly —
   * adopted here instead of through a hosting environment variable and a
   * redeploy. From then on the site refreshes it like any other.
   */
  function igTokenForm() {
    return (
      '<details class="ig-details"><summary>Paste a long-lived access token</summary>' +
      '<label class="field"><span class="label">Instagram access token</span>' +
      '<input class="input" id="ig-token" type="password" autocomplete="off" placeholder="IGAA…"></label>' +
      '<p><button class="btn btn-sm btn-accent" type="button" data-action="ig-save-token">Save token</button></p>' +
      '<p class="hint">Checked against the account before it is saved, then kept alive here — a long-lived ' +
      'token dies for good after 60 days without a refresh. It is stored with your password and never shown again.</p>' +
      '</details>'
    );
  }

  /**
   * The app id and secret, entered here rather than in the hosting dashboard.
   * They are stored server-side with the admin password and never sent back
   * down, so the secret box is always blank on a fresh load.
   */
  function igAppForm(ig) {
    var redirect = (ig && ig.redirectUri) || location.origin + '/admin';
    return (
      '<ol class="ig-steps">' +
      '<li>Make sure @taylordrew4u is a <strong>Business</strong> or <strong>Creator</strong> account ' +
      '(Instagram app → Settings → Account type and tools). A personal account cannot be read by any app.</li>' +
      '<li>Open <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener">developers.facebook.com/apps</a> ' +
      'and click <em>Create app</em>. Give it any name. When it asks what you are building, choose ' +
      '<em>Other</em>, then <em>Business</em>.</li>' +
      '<li>In the new app, add the <strong>Instagram</strong> product, then open ' +
      '<em>API setup with Instagram login</em>.</li>' +
      '<li>Under step 3, <em>Set up Instagram business login</em>, paste this into ' +
      '<em>OAuth redirect URIs</em> — it has to match exactly:' +
      '<br><code class="ig-copy">' + esc(redirect) + '</code> ' +
      '<button class="btn btn-sm btn-ghost" type="button" data-action="ig-copy-redirect" ' +
      'data-value="' + esc(redirect) + '">Copy</button></li>' +
      '<li>Copy the <strong>Instagram app ID</strong> and <strong>Instagram app secret</strong> from step 1 ' +
      'on that same page into the boxes below and save.</li>' +
      '</ol>' +
      '<div class="grid-2">' +
      '<label class="field"><span class="label">Instagram app ID</span>' +
      '<input class="input" id="ig-app-id" type="text" inputmode="numeric" autocomplete="off" ' +
      'placeholder="1234567890123456" value="' + esc((ig && ig.appId) || '') + '"></label>' +
      '<label class="field"><span class="label">Instagram app secret</span>' +
      '<input class="input" id="ig-app-secret" type="password" autocomplete="off" ' +
      'placeholder="' + (ig && ig.appSecretSet ? 'Saved — leave blank to keep it' : '32 hex characters') + '"></label>' +
      '</div>' +
      '<label class="switch"><input type="checkbox" id="ig-messaging"' +
      (ig && ig.messaging ? ' checked' : '') + '> ' +
      '<span>Also let this site send direct messages as the account</span></label>' +
      '<p class="hint">Off by default. Turning it on asks Instagram for one more permission when you connect, ' +
      'so an app that was never set up for messaging keeps working. ' +
      'Tick it, save, then connect (or reconnect) — the permission comes with the new token, not the tickbox.</p>' +
      '<p><button class="btn btn-sm btn-accent" type="button" data-action="ig-save-app">Save app details</button>' +
      (ig && ig.appSource === 'panel'
        ? ' <button class="btn btn-sm btn-ghost" type="button" data-action="ig-forget-app">Forget them</button>'
        : '') +
      '</p>' +
      '<p class="hint">The secret is kept with your password and is never shown again. ' +
      'Once both are saved, a <em>Connect Instagram</em> button appears here — one login and the wall fills itself, ' +
      'renewing its own access from then on.</p>'
    );
  }

  /**
   * Sending a DM, for the account that has said it wants to.
   *
   * Two rules of Instagram's are worth stating on the form rather than letting
   * someone discover them as an error: the recipient is the all-digit ID that
   * arrives with an incoming message — there is no way to look one up from an
   * @handle — and a reply is only allowed within 24 hours of their last message.
   */
  function igMessageForm(ig) {
    if (!ig || !ig.messaging) return '';
    if (!ig.messagingScope) {
      return (
        '<p class="hint"><strong>Direct messages are on, but this token was not granted them.</strong> ' +
        'Disconnect and connect again — the button now forces the consent screen, which is where the ' +
        'messaging permission is actually approved.</p>'
      );
    }
    return (
      '<details class="ig-details"><summary>Send a direct message</summary>' +
      '<div class="grid-2">' +
      '<label class="field"><span class="label">Recipient ID</span>' +
      '<input class="input" id="ig-dm-to" type="text" inputmode="numeric" autocomplete="off" ' +
      'placeholder="17841400000000000"></label>' +
      '<label class="field"><span class="label">Message</span>' +
      '<input class="input" id="ig-dm-text" type="text" autocomplete="off" maxlength="1000" ' +
      'placeholder="Hello World"></label>' +
      '</div>' +
      '<p><button class="btn btn-sm btn-accent" type="button" data-action="ig-send-dm">Send</button></p>' +
      '<p class="hint">The recipient is an Instagram-scoped ID — the all-digit sender id that comes in with ' +
      'their message, not an @handle; there is no way to look one up. Instagram only allows a reply within ' +
      '<strong>24 hours</strong> of their last message and refuses outside it.</p>' +
      '</details>'
    );
  }

  function sectionReels() {
    var reels = state.site.reels || { items: [] };
    var items = (reels.items || []).length
      ? '<div class="repeat-list" data-sortable="reels.items">' +
        reels.items
          .map(function (r, i) {
            var base = 'reels.items.' + i;
            return repeatItem({
              list: 'reels.items',
              index: i,
              title: r.caption || r.url || 'Reel',
              body:
                field({
                  label: 'Instagram link',
                  path: base + '.url',
                  value: r.url,
                  titleSource: true,
                  placeholder: 'https://www.instagram.com/reel/…'
                }) +
                '<div class="grid-2">' +
                field({
                  label: 'Video URL (loops)',
                  path: base + '.video',
                  value: r.video,
                  placeholder: 'https://…/clip.mp4',
                  hint: 'A tile only plays on a loop when it has its own video. Instagram will not let their embed autoplay here.'
                }) +
                field({ label: 'Poster description', path: base + '.posterAlt', value: r.posterAlt, seo: false }) +
                imageField({ label: 'Poster / cover frame', path: base + '.poster', value: r.poster, seoTarget: base + '.posterAlt' }) +
                '</div>' +
                field({
                  label: 'Description',
                  path: base + '.caption',
                  value: r.caption,
                  placeholder: 'Crowd work at the Cellar',
                  hint: 'Read aloud by screen readers, and what image search has to go on.'
                }) +
                '<div class="row-switches">' +
                toggleField({ label: 'Show on the site', path: base + '.visible', checked: r.visible !== false }) +
                '</div>'
            });
          })
          .join('') +
        '</div>'
      : emptyState('No reels yet.');

    return (
      card(
        'Header',
        '<div class="grid-2">' +
          field({ label: 'Kicker', path: 'reels.kicker', value: reels.kicker }) +
          field({ label: 'Title', path: 'reels.title', value: reels.title }) +
          '</div>' +
          textareaField({ label: 'Intro', path: 'reels.intro', value: reels.intro, rows: 2 })
      ) +
      card(
        'From your Instagram',
        field({
          label: 'Instagram feed URL',
          path: 'reels.feedUrl',
          value: reels.feedUrl,
          placeholder: 'https://feeds.behold.so/…',
          hint:
            'NOT your instagram.com page — Instagram blocks websites from reading that. Go to behold.so (free), click Connect Instagram, log in as @taylordrew4u, and copy the feed URL it hands back (it looks like https://feeds.behold.so/xxxxx). Paste that here and save.'
        }) +
          '<p class="hint">Leave it empty to use a Meta developer app instead:</p>' +
          igStatus(),
        {
          subtitle:
            'Instagram will not let any site read your account without a login somewhere. The quickest way is a connector that holds that login for you — one paste and you are done.'
        }
      ) +
      card('Pinned reels', items, {
        subtitle:
          'Anything here shows before the feed. A tile plays silently on a loop if you give it a video URL; with only an Instagram link it falls back to Instagram\u2019s own embed, which they do not allow to autoplay.',
        actions:
          '<button class="btn btn-sm btn-accent" type="button" data-action="list-add" data-list="reels.items">Add reel</button>'
      })
    );
  }

  function sectionNav() {
    var nav = state.site.nav || [];
    var body = nav.length
      ? '<div class="repeat-list" data-sortable="nav">' +
        nav
          .map(function (item, i) {
            return repeatItem({
              list: 'nav',
              index: i,
              title: item.label,
              badges: item.visible === false ? [{ text: 'Hidden', cls: 'is-hidden' }] : [],
              body:
                '<div class="grid-2">' +
                field({ label: 'Label', path: 'nav.' + i + '.label', value: item.label, titleSource: true }) +
                field({ label: 'Link', path: 'nav.' + i + '.href', value: item.href, hint: '/ , /about, /links or a full URL.' }) +
                '</div>' +
                toggleField({ label: 'Visible', path: 'nav.' + i + '.visible', checked: item.visible !== false })
            });
          })
          .join('') +
        '</div>'
      : emptyState('The menu is empty.');

    return card('Header menu', body, {
      actions: '<button class="btn btn-sm btn-accent" type="button" data-action="list-add" data-list="nav">Add menu item</button>'
    });
  }

  function sectionThemes() {
    var themes = state.site.themes;
    var options = themes.options
      .map(function (t, i) {
        var swatches = ['bg', 'surface', 'text', 'accent']
          .map(function (key) {
            return '<span style="display:inline-block;width:22px;height:22px;border:1px solid #333;background:' + esc(t[key]) + '"></span>';
          })
          .join(' ');
        return card(
          'Theme ' + t.id,
          '<div class="grid-2">' +
            field({ label: 'Name', path: 'themes.options.' + i + '.name', value: t.name }) +
            field({ label: 'Key', path: 'themes.options.' + i + '.id', value: t.id, hint: 'One or two characters, used to name this scheme.' }) +
            '</div>' +
            '<div class="grid-3">' +
            colorField('Background', 'themes.options.' + i + '.bg', t.bg) +
            colorField('Panel', 'themes.options.' + i + '.surface', t.surface) +
            colorField('Text', 'themes.options.' + i + '.text', t.text) +
            colorField('Muted text', 'themes.options.' + i + '.muted', t.muted) +
            colorField('Accent', 'themes.options.' + i + '.accent', t.accent) +
            colorField('Text on accent', 'themes.options.' + i + '.accentText', t.accentText) +
            colorField('Rules & borders', 'themes.options.' + i + '.line', t.line) +
            '</div>',
          { subtitle: 'Preview: ', actions: swatches }
        );
      })
      .join('');

    var defaultOptions = themes.options
      .map(function (t) {
        return '<option value="' + esc(t.id) + '"' + (themes.default === t.id ? ' selected' : '') + '>' + esc(t.id + ' — ' + t.name) + '</option>';
      })
      .join('');

    return (
      card(
        'Theme settings',
        '<div class="field"><label class="label" for="theme-default">Default theme</label>' +
          '<select class="select" id="theme-default" data-path="themes.default" data-rerender="1">' + defaultOptions + '</select>' +
          '<span class="hint">The colours the site is served with.</span></div>'
      ) + options
    );
  }

  function sectionContact() {
    var contact = state.site.contact;
    return card(
      'Contact page',
      '<div class="grid-2">' +
        field({ label: 'Kicker', path: 'contact.kicker', value: contact.kicker }) +
        field({ label: 'Title', path: 'contact.title', value: contact.title }) +
        '</div>' +
        textareaField({ label: 'Intro', path: 'contact.intro', value: contact.intro, rows: 2 }) +
        '<div class="grid-2">' +
        field({
          label: 'To',
          path: 'contact.to',
          value: contact.to,
          hint: 'The address the Send button opens a message to.'
        }) +
        field({ label: 'Subject', path: 'contact.subject', value: contact.subject }) +
        '</div>' +
        textareaField({
          label: 'Message hint',
          path: 'contact.placeholder',
          value: contact.placeholder,
          rows: 3,
          hint: 'What to tell people to include. Shown on the page above the button.'
        }) +
        field({ label: 'Send button', path: 'contact.sendLabel', value: contact.sendLabel })
    );
  }

  function sectionFooter() {
    var footer = state.site.footer;
    return card(
      'Footer',
      '<div class="grid-2">' +
        field({ label: 'Left text', path: 'footer.left', value: footer.left }) +
        field({ label: 'Right text', path: 'footer.right', value: footer.right }) +
        field({ label: 'Right link', path: 'footer.rightHref', value: footer.rightHref, hint: 'mailto:you@example.com works well.' }) +
        field({ label: 'Middle note', path: 'footer.note', value: footer.note, hint: 'Optional.' }) +
        '</div>'
    );
  }

  function sectionPhotos() {
    var photos = state.site.photos || { kicker: 'Photos', title: 'Photos', intro: '', items: [] };
    var items = (photos.items || []).map(function (photo, i) {
      var base = 'photos.items.' + i;
      return repeatItem({ list: 'photos.items', index: i, title: photo.title || 'Photo ' + (i + 1),
        badges: photo.visible === false ? [{ text: 'Hidden' }] : [],
        body: imageField({ label: 'Photo', path: base + '.photo', value: photo.photo, seoTarget: base + '.photoAlt' }) +
          field({ label: 'Photo title', path: base + '.title', value: photo.title, titleSource: true, attrs: ' maxlength="120"', placeholder: 'Taylor Drew performing stand-up' }) +
          textareaField({ label: 'Image description (alt text)', path: base + '.photoAlt', value: photo.photoAlt, rows: 2, seo: false, hint: 'Describe what is actually in this photo. Include your name when you are pictured, plus the setting or event when known.' }) +
          textareaField({ label: 'Caption', path: base + '.caption', value: photo.caption, rows: 2, hint: 'Shown below the photo. Add useful context rather than repeating keywords.' }) +
          field({ label: 'Photographer / credit', path: base + '.credit', value: photo.credit, seo: false, attrs: ' maxlength="160"', hint: 'Optional. Use the photographer’s requested credit.' }) +
          toggleField({ label: 'Show on the site', path: base + '.visible', checked: photo.visible !== false })
      });
    }).join('');
    return card('Photo gallery',
      '<p class="hint">Publish photos on <a href="/photos" target="_blank" rel="noopener">your Photos page ↗</a>. Published photos are included in the image sitemap. Add accurate descriptions and captions, then save changes.</p>' +
      '<label class="upload-drop" data-gallery-drop="1"><input type="file" accept="image/*" multiple hidden data-gallery-input="1"' + (state.galleryBusy ? ' disabled' : '') + '><span>' + (state.galleryBusy ? 'Uploading photos…' : 'Drop photos here or click to upload several') + '</span><small>Photos are resized for fast loading. Up to 100 gallery photos.</small></label>' +
      '<div class="grid-2">' + field({ label: 'Page title', path: 'photos.title', value: photos.title }) + field({ label: 'Kicker', path: 'photos.kicker', value: photos.kicker }) + '</div>' +
      textareaField({ label: 'Introduction', path: 'photos.intro', value: photos.intro, rows: 2 })
    ) + card('Photos', items ? '<div class="repeat-list" data-sortable="photos.items">' + items + '</div>' : emptyState('Upload photos above, or add one from your media library.'), {
      actions: '<button class="btn btn-sm btn-accent" type="button" data-action="list-add" data-list="photos.items">Add photo from library</button>'
    });
  }

  function addGalleryPhoto(url) {
    var items = getPath(state.site, 'photos.items') || [];
    if (items.length >= 100) { toast('The gallery holds up to 100 photos.', 'error'); return false; }
    var photo = TEMPLATES['photos.items']();
    photo.photo = url || '';
    items.push(photo);
    setPath(state.site, 'photos.items', items);
    markDirty();
    return true;
  }

  async function uploadGalleryFiles(files) {
    if (state.galleryBusy) return;
    if (state.saving) return toast('Let the current save finish before uploading photos.', 'info');
    var queue = Array.from(files || []).filter(function (file) { return /^image\//.test(file.type); });
    var available = 100 - (getPath(state.site, 'photos.items') || []).length;
    if (!queue.length) return toast('Choose image files to add to the gallery.', 'error');
    if (queue.length > available) return toast('There is room for ' + available + ' more photos. Select fewer files.', 'error');
    state.galleryBusy = true;
    render({ preserveFocus: false });
    var uploaded = 0;
    try {
      for (var file of queue) {
        try {
          var prepared = await prepareImage(file);
          var data = await api('/admin/uploads', { method: 'POST', body: { name: file.name, dataUrl: prepared.dataUrl } });
          if (state.site && addGalleryPhoto(data.file.url)) uploaded++;
        } catch (err) { toast(file.name + ': ' + err.message, 'error'); }
      }
      await loadMedia();
      if (uploaded) toast(uploaded + ' photos added. Add descriptions, then save to publish.', 'ok');
    } catch (err) { toast(err.message, 'error'); }
    finally { state.galleryBusy = false; if (state.site) render({ preserveFocus: false }); }
  }

  /** Where an uploaded image is currently used, so nothing vanishes by surprise. */
  var MEDIA_SLOTS = [
    { path: 'home.photo', label: 'Hero photo' },
    { path: 'about.photo', label: 'About photo' },
    { path: 'seo.ogImage', label: 'Share image' },
    { path: 'seo.favicon', label: 'App icon' }
  ];

  function mediaUsage(url) {
    if (!state.site) return [];
    return MEDIA_SLOTS.filter(function (slot) {
      return getPath(state.site, slot.path) === url;
    }).map(function (slot) {
      return slot.label;
    }).concat(((state.site.photos || {}).items || []).filter(function (photo) { return photo.photo === url; }).map(function (photo) { return 'Gallery: ' + (photo.title || 'photo'); }));
  }

  function mediaCard(file, withPick) {
    var usedIn = mediaUsage(file.url);
    return (
      '<div class="media-item' + (usedIn.length ? ' is-used' : '') + '">' +
      '<div class="media-thumb" style="background-image:url(' + esc(file.url) + ')" data-action="' + (withPick ? 'choose-media' : 'copy-media') + '" data-url="' + esc(file.url) + '"></div>' +
      '<div class="media-meta">' +
      (usedIn.length ? '<span class="media-badge">' + esc(usedIn.join(' · ')) + '</span>' : '') +
      esc(file.name) + '<br>' + esc(formatSize(file.size)) + '</div>' +
      '<div class="media-actions">' +
      (withPick
        ? '<button class="btn btn-sm btn-accent" type="button" data-action="choose-media" data-url="' + esc(file.url) + '">Use</button>'
        : '<button class="btn btn-sm" type="button" data-action="copy-media" data-url="' + esc(file.url) + '">Copy URL</button><button class="btn btn-sm" type="button" data-action="gallery-add-media" data-url="' + esc(file.url) + '">Add to Photos</button>') +
      '<button class="btn btn-sm btn-danger" type="button" data-action="delete-media" data-name="' + esc(file.name) + '">Delete</button>' +
      '</div></div>'
    );
  }

  function sectionMedia() {
    var grid = state.media.length
      ? '<div class="media-grid">' + state.media.map(function (f) { return mediaCard(f, false); }).join('') + '</div>'
      : emptyState('No images uploaded yet.');
    return card(
      'Media library',
      '<label class="upload-drop" data-upload-drop="1">' +
        '<input type="file" accept="image/*" multiple hidden data-upload-input="1">' +
        '<span>Drop images here or click to upload</span>' +
        '<small>PNG, JPG, WebP, GIF, AVIF or SVG · up to 8 MB</small>' +
        '</label>' + grid,
      { subtitle: 'Uploads are stored on the server and can be used anywhere an image is asked for.' }
    );
  }

  function sectionData() {
    // On the GitHub backend a snapshot is a commit, so it is labelled by its
    // message and short sha rather than by a filename and a byte count.
    var backedByGit = /github/i.test(state.storage || '');

    var backups = state.backups.length
      ? '<table class="table"><thead><tr><th>' + (backedByGit ? 'Commit' : 'Snapshot') + '</th><th>Taken</th>' +
        (backedByGit ? '' : '<th>Size</th>') + '<th></th></tr></thead><tbody>' +
        state.backups
          .map(function (b) {
            var ref = String(b.name).replace(/^site-/, '').replace(/\.json$/, '');
            var label = backedByGit
              ? (String(b.message || 'Saved from the admin panel').replace(/\[skip ci\]/gi, '').trim() || 'Saved') +
                ' · ' + ref.slice(0, 7)
              : b.name;
            return (
              '<tr><td class="wrap">' + esc(label) + '</td><td>' + esc(formatDate(b.createdAt)) + '</td>' +
              (backedByGit ? '' : '<td>' + esc(b.size ? formatSize(b.size) : '—') + '</td>') +
              '<td><button class="btn btn-sm" type="button" data-action="restore-backup" data-name="' + esc(b.name) + '">Restore</button></td></tr>'
            );
          })
          .join('') +
        '</tbody></table>'
      : emptyState(
          backedByGit
            ? 'No earlier versions yet — the next save will create one.'
            : 'No snapshots yet — one is taken automatically every time you save.'
        );

    return (
      card('Export & import',
        '<div class="image-buttons">' +
          '<button class="btn btn-sm" type="button" data-action="export">Download a copy</button>' +
          '<label class="btn btn-sm" style="cursor:pointer">Import a file<input type="file" accept="application/json" hidden data-import-input="1"></label>' +
          '</div><p class="hint" style="margin-top:10px">Importing replaces all site content. Your password is never included in an export.</p>',
        { subtitle: 'A JSON file with everything on the site.' }) +
      card(backedByGit ? 'Version history' : 'Snapshots', backups, {
        subtitle: backedByGit
          ? 'Every save is a commit in the repository, so this is the file\'s own history.'
          : 'The last 30 saves, oldest pruned automatically.'
      }) +
      card('Danger zone',
        '<button class="btn btn-sm btn-danger" type="button" data-action="reset-site">Reset all content to defaults</button>' +
          '<p class="hint" style="margin-top:10px">Your password and uploaded images are kept. The current version is recorded first, so this can be undone from the list above.</p>')
    );
  }

  function sectionSecurity() {
    var rows = state.sessions.length
      ? state.sessions
          .map(function (s) {
            return (
              '<tr><td>' + esc(s.id) + (s.current ? ' <span class="tag">This device</span>' : '') + '</td>' +
              '<td>' + esc(formatDate(s.createdAt)) + '</td><td>' + esc(s.ip || '—') + '</td>' +
              '<td class="wrap">' + esc(s.agent || '—') + '</td></tr>'
            );
          })
          .join('')
      : '<tr><td colspan="4">No active sessions.</td></tr>';

    return (
      (state.usingDefaultPassword
        ? '<div class="notice"><div><strong>Default password in use.</strong>Set your own below.</div></div>'
        : '') +
      card(
        'Change password',
        '<form id="password-form">' +
          '<div class="grid-2">' +
          '<div class="field"><label class="label" for="cur-pass">Current password</label><input class="input" type="password" id="cur-pass" autocomplete="current-password" required></div>' +
          '<div class="field"><label class="label" for="new-pass">New password</label><input class="input" type="password" id="new-pass" autocomplete="new-password" minlength="4" required></div>' +
          '</div>' +
          '<button class="btn btn-accent btn-sm" type="submit">Update password</button>' +
          '<p class="hint" style="margin-top:10px">You will be signed out of every device afterwards.</p>' +
          '</form>'
      ) +
      card('Site access key', apiKeyCard()) +
      card(
        'Signed-in devices',
        '<table class="table"><thead><tr><th>Session</th><th>Signed in</th><th>IP</th><th>Browser</th></tr></thead><tbody>' + rows + '</tbody></table>',
        { actions: '<button class="btn btn-sm btn-danger" type="button" data-action="revoke-sessions">Sign out everywhere</button>' }
      )
    );
  }

  /**
   * A key for editing the site without a browser — an agent, a script, a phone
   * shortcut. Only its hash is stored, so the key itself is shown once and
   * never again; `state.freshApiKey` holds it only until the next render.
   */
  var AI_PRESETS = {
    custom: { label: '', protocol: 'openai', baseUrl: '', model: '' },
    openai: { label: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
    anthropic: { label: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5' },
    gemini: { label: 'Google Gemini', protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' }
  };
  function aiProvidersCard() {
    var info = state.flyer || {};
    var configured = (info.providers || []).filter(function (provider) { return provider.configured; });
    var editor = state.aiEditor || { preset: 'custom' };
    var mode = info.mode || 'browser';
    var field = function (id, label, value, placeholder, type) {
      return '<div class="field"><label class="label" for="' + id + '">' + label + '</label><input class="input" id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value || '') + '" placeholder="' + esc(placeholder || '') + '" autocomplete="off"></div>';
    };
    return card('Choose how to generate',
      '<p class="hint">Use your own APIs in the order below. If a provider runs out of credits, times out or fails, the next enabled provider is tried automatically. Each provider uses its own account and billing.</p>' +
      '<div class="row-actions"><button class="btn btn-sm' + (mode === 'hosted' ? ' btn-accent' : '') + '" type="button" data-action="ai-mode" data-mode="hosted" aria-pressed="' + (mode === 'hosted') + '">Use my APIs</button>' +
      '<button class="btn btn-sm' + (mode === 'browser' ? ' btn-accent' : '') + '" type="button" data-action="ai-mode" data-mode="browser" aria-pressed="' + (mode === 'browser') + '">Use free browser AI</button></div>' +
      '<p class="hint">Current mode: <strong>' + (mode === 'hosted' ? 'Your API providers' : 'Free browser AI') + '</strong>. Settings here save immediately.</p>' +
      (state.aiLastProvider ? '<p class="hint">Last used: ' + esc(state.aiLastProvider) + '</p>' : '')) +
      card('Fallback order', configured.length ? configured.map(function (provider, index) {
        return '<div class="ai-provider-row"><div><strong>' + (index + 1) + '. ' + esc(provider.label) + '</strong>' +
          '<p class="hint">' + esc(provider.model) + (provider.enabled === false ? ' · Disabled' : ' · Enabled') + '</p><small class="hint">' + esc(provider.baseUrl) + '</small>' +
          (provider.source === 'environment' ? '<p class="hint">Key supplied by hosting settings. You can disable it here.</p>' : '') + '</div><div class="row-actions">' +
          '<button class="btn btn-sm" type="button" data-action="ai-move" data-provider="' + esc(provider.id) + '" data-dir="-1" aria-label="Move ' + esc(provider.label) + ' earlier"' + (!index ? ' disabled' : '') + '>↑</button>' +
          '<button class="btn btn-sm" type="button" data-action="ai-move" data-provider="' + esc(provider.id) + '" data-dir="1" aria-label="Move ' + esc(provider.label) + ' later"' + (index === configured.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button class="btn btn-sm" type="button" data-action="ai-edit" data-provider="' + esc(provider.id) + '">Edit</button>' +
          '<button class="btn btn-sm btn-ghost" type="button" data-action="ai-remove" data-provider="' + esc(provider.id) + '"' + (provider.source === 'environment' && provider.enabled === false ? ' disabled' : '') + '>' + (provider.source === 'environment' ? 'Disable' : 'Remove') + '</button></div></div>';
      }).join('') : '<p class="hint">No API providers saved yet. Add one below, then choose Use my APIs.</p>') +
      card(editor.id ? 'Edit provider' : 'Add an API provider',
        '<div class="field"><label class="label" for="ai-preset">Provider preset</label><select class="input" id="ai-preset">' +
        Object.keys(AI_PRESETS).map(function (key) { return '<option value="' + key + '"' + ((editor.preset || 'custom') === key ? ' selected' : '') + '>' + (key === 'custom' ? 'Custom API' : AI_PRESETS[key].label) + '</option>'; }).join('') + '</select></div>' +
        '<div class="grid-2">' + field('ai-label', 'Connection name', editor.label, 'My backup provider') +
        field('ai-model', 'Model ID', editor.model, 'Model name from your provider') + '</div>' +
        '<div class="field"><label class="label" for="ai-protocol">API format</label><select class="input" id="ai-protocol"><option value="openai"' + (editor.protocol !== 'anthropic' ? ' selected' : '') + '>OpenAI-compatible chat completions</option><option value="anthropic"' + (editor.protocol === 'anthropic' ? ' selected' : '') + '>Anthropic Messages</option></select></div>' +
        field('ai-url', 'API base URL', editor.baseUrl, 'https://your-provider.example/v1', 'url') +
        '<p class="hint">Use the public HTTPS API base URL, without /chat/completions or /messages. Custom providers must support the selected format. Choose an image-capable model for photos and flyers.</p>' +
        field('ai-key', 'API key', '', editor.id ? 'Leave blank to keep the existing key' : 'Paste your provider API key', 'password') +
        '<p class="hint">Keys stay on the server and are never displayed after saving.</p>' +
        '<label class="switch"><input id="ai-enabled" type="checkbox"' + (editor.enabled !== false ? ' checked' : '') + '> Enable this provider</label>' +
        '<div class="row-actions"><button class="btn btn-sm btn-accent" type="button" data-action="ai-save">Save provider</button>' +
        (editor.id ? '<button class="btn btn-sm" type="button" data-action="ai-new">Add another provider</button>' : '') + '</div>') +
      card('Free browser option',
        '<p class="hint">The free model runs on your device without API keys. It needs WebGPU — Safari 18 or later, or Chrome, on a Mac — and a one-time model download that your browser then caches. If the browser asks to store data on this site, allow it, or the download is thrown away. Pick the size that suits the computer you edit on — saved in this browser only.</p>' +
        '<div class="row-actions">' + FREE_SIZES.map(function (option) {
          return '<button class="btn btn-sm' + (freeSize() === option.id ? ' btn-accent' : '') + '" type="button" data-action="ai-size" data-size="' + option.id + '" aria-pressed="' + (freeSize() === option.id) + '">' + esc(option.label) + '</button>';
        }).join('') + '</div>' +
        '<p class="hint">' + esc((FREE_SIZES.filter(function (option) { return option.id === freeSize(); })[0] || FREE_SIZES[1]).hint) + ' The strongest model that fits inside that size is loaded; if it will not fit, the next one down is tried.</p>' +
        (state.aiLastModel ? '<p class="hint">Last run on this device: <strong>' + esc(state.aiLastModel) + '</strong></p>' : '') +
        '<p class="hint">API mode uses only your enabled providers; switching modes is always your choice.</p>');
  }

  // Which free model to load. Kept in this browser only: it describes the
  // machine sitting in front of the panel, not the site.
  var FREE_SIZES = [
    { id: 'fast', label: 'Fast', hint: 'About 2 GB. Older laptops and small GPUs.' },
    { id: 'balanced', label: 'Balanced', hint: 'About 4 GB. The default, and fine on most laptops.' },
    { id: 'best', label: 'Best', hint: 'Up to 6 GB. Desktop graphics card, slow to download.' }
  ];
  function freeSize() {
    try {
      var saved = localStorage.getItem('taylosite.freeAiSize');
      return FREE_SIZES.some(function (option) { return option.id === saved; }) ? saved : 'balanced';
    } catch (_) { return 'balanced'; }
  }
  function setFreeSize(value) { try { localStorage.setItem('taylosite.freeAiSize', value); } catch (_) {} }

  function generateAI(options) {
    if (state.flyer && state.flyer.mode === 'hosted') {
      if (options.onProgress) options.onProgress('Trying your API providers in order…');
      return api('/admin/ai-generate', { method: 'POST', body: {
        messages: options.messages, schema: options.schema, vision: Boolean(options.vision),
        temperature: options.temperature, maxTokens: options.maxTokens || (options.vision ? 512 : 1800)
      } }).then(function (result) {
        if (result._provider) state.aiLastProvider = result._provider.label + (result._fallbackCount ? ' (after fallback)' : '');
        return result;
      });
    }
    return import('/assets/js/free-ai.js').then(function (ai) {
      return ai.generate(Object.assign({}, options, {
        size: freeSize(),
        onModel: function (model) { state.aiLastModel = model; }
      }));
    });
  }

  function apiKeyCard() {
    var info = state.apiKey || { set: false };
    var fresh = state.freshApiKey
      ? '<div class="notice"><div><strong>Copy it now — it is not shown again.</strong>' +
        '<code class="ig-copy">' + esc(state.freshApiKey) + '</code> ' +
        '<button class="btn btn-sm btn-ghost" type="button" data-action="ig-copy-redirect" ' +
        'data-value="' + esc(state.freshApiKey) + '">Copy</button></div></div>'
      : '';

    return (
      fresh +
      '<p class="hint">Lets a script or an assistant read and edit your content and images without your ' +
      'password. It is deliberately limited: it <strong>cannot</strong> change your password, sign anyone ' +
      'out, reach your Instagram or AI provider keys, export the site, or make another key. Anything it is ' +
      'not allowed to touch is refused outright.</p>' +
      (info.set
        ? '<p class="hint"><strong>A key is active' + (info.label ? ' (' + esc(info.label) + ')' : '') + '.</strong> ' +
          'Made ' + esc(formatDate(info.createdAt)) + '. ' +
          (info.lastUsedAt ? 'Last used ' + esc(formatDate(info.lastUsedAt)) + '.' : 'Not used yet.') +
          '</p>'
        : '<p class="hint">No key right now.</p>') +
      '<label class="field" style="max-width:320px"><span class="label">What is it for</span>' +
      '<input class="input" id="apikey-label" type="text" maxlength="60" placeholder="Claude"></label>' +
      '<p><button class="btn btn-sm btn-accent" type="button" data-action="apikey-create">' +
      (info.set ? 'Replace the key' : 'Make a key') + '</button>' +
      (info.set
        ? ' <button class="btn btn-sm btn-danger" type="button" data-action="apikey-revoke">Revoke it</button>'
        : '') +
      '</p>' +
      (info.set ? '<p class="hint">Making a new one replaces the old one immediately.</p>' : '')
    );
  }

  var RENDERERS = {
    overview: sectionOverview,
    brand: sectionBrand,
    home: sectionHome,
    links: sectionLinks,
    shows: sectionShows,
    about: sectionAbout,
    reels: sectionReels,
    contact: sectionContact,
    nav: sectionNav,
    themes: sectionThemes,
    footer: sectionFooter,
    media: sectionMedia,
    photos: sectionPhotos,
    data: sectionData,
    ai: aiProvidersCard,
    security: sectionSecurity
  };

  // -------------------------------------------------------------- rendering

  /** Which sections differ from what is on the server right now. */
  function changedSections() {
    var changed = {};
    if (!state.saved || !state.site) return changed;
    var saved = JSON.parse(state.saved);
    SECTIONS.forEach(function (section) {
      if (!section.keys) return;
      changed[section.id] = section.keys.some(function (key) {
        return JSON.stringify(state.site[key]) !== JSON.stringify(saved[key]);
      });
    });
    return changed;
  }

  function renderSidebar() {
    var counts = {
      links: (state.site.links.items || []).length,
      shows: (state.site.shows || []).length,
      nav: (state.site.nav || []).length,
      media: state.media.length,
      photos: ((state.site.photos || {}).items || []).length
    };
    var changed = changedSections();
    var setupCounts = {};
    missingSetupItems().forEach(function (item) { setupCounts[item.section] = (setupCounts[item.section] || 0) + 1; });
    el.nav.innerHTML = SECTIONS.map(function (s) {
      return (
        '<button class="side-item' + (s.id === state.section ? ' is-active' : '') +
        (changed[s.id] ? ' is-changed' : '') + '" type="button" data-section="' + s.id + '"' +
        (changed[s.id] ? ' title="Unsaved changes in this section"' : '') + '>' +
        icon(ICONS[s.id]) + '<span>' + esc(s.label) + '</span>' +
        (changed[s.id] ? '<span class="side-dot" aria-label="unsaved changes"></span>' : '') +
        (setupCounts[s.id] ? '<span class="side-needs" title="' + setupCounts[s.id] + ' setup items missing">' + setupCounts[s.id] + '</span>' : '') +
        (counts[s.id] != null ? '<span class="side-count">' + counts[s.id] + '</span>' : '') +
        '</button>'
      );
    }).join('');
  }

  function render(options) {
    options = options || {};
    var active = document.activeElement;
    var focusPath = options.preserveFocus !== false && active && active.dataset ? active.dataset.path : null;
    var selectionStart = focusPath && 'selectionStart' in active ? active.selectionStart : null;
    var scroll = el.panel.scrollTop;

    var section = SECTIONS.filter(function (s) {
      return s.id === state.section;
    })[0] || SECTIONS[0];

    el.title.textContent = section.label;
    el.hint.textContent = section.hint;
    el.panel.innerHTML = RENDERERS[section.id]();
    renderSidebar();
    el.panel.scrollTop = scroll;

    if (focusPath) {
      var next = el.panel.querySelector('[data-path="' + focusPath.replace(/"/g, '\\"') + '"]');
      if (next) {
        next.focus();
        if (selectionStart != null && 'setSelectionRange' in next) {
          try {
            next.setSelectionRange(selectionStart, selectionStart);
          } catch (e) {
            /* not a text input */
          }
        }
      }
    }
  }

  function go(sectionId) {
    // A freshly minted key is on screen exactly once. Leaving the section is
    // the moment it stops being offered, so it does not reappear later to
    // someone reading over a shoulder.
    if (sectionId !== state.section) state.freshApiKey = '';
    state.section = sectionId;
    location.hash = sectionId;
    document.getElementById('app').classList.remove('nav-open');
    render({ preserveFocus: false });
    el.panel.scrollTop = 0;
  }

  /**
   * Dirty state is derived by comparing against the last server response, so
   * typing something and typing it back leaves the panel clean.
   */
  function refreshDirty() {
    if (!state.site) return;
    state.dirty = JSON.stringify(state.site) !== state.saved;
    if (state.saving) return;
    el.saveState.textContent = state.dirty
      ? 'Unsaved changes'
      : 'Saved ' + relativeTime(state.stats && state.stats.updatedAt);
    el.saveState.className = 'save-state' + (state.dirty ? ' is-dirty' : '');
    el.save.disabled = !state.dirty;
    el.revert.disabled = !state.dirty;
  }

  function markDirty() {
    refreshDirty();
    renderSidebar();
  }

  function markClean() {
    state.saved = JSON.stringify(state.site);
    refreshDirty();
  }

  // Keep the "saved 3 min ago" label honest without re-rendering the panel.
  setInterval(function () {
    if (state.site && !state.dirty && !state.saving) refreshDirty();
  }, 30000);

  // ------------------------------------------------------------- list ops

  var TEMPLATES = {
    'links.items': function () {
      return { id: uid('link'), label: 'New link', sublabel: '', url: '', visible: true, featured: false, clicks: 0 };
    },
    shows: function () {
      return { id: uid('show'), date: '', time: '', venue: '', city: '', street: '', postalCode: '', country: '', url: '', ctaLabel: 'Tickets', note: '', flyer: '', soldOut: false, visible: true };
    },
    nav: function () {
      return { id: uid('nav'), label: 'New item', href: '/', visible: true };
    },
    'about.body': function () {
      return 'New paragraph.';
    },
    'about.facts': function () {
      return { id: uid('fact'), label: '', value: '' };
    },
    'about.quotes': function () {
      return { id: uid('quote'), text: '', source: '' };
    },
    'reels.items': function () {
      return { id: uid('reel'), url: '', video: '', poster: '', caption: '', visible: true };
    },
    'photos.items': function () {
      return { id: uid('photo'), photo: '', photoAlt: '', title: '', caption: '', credit: '', visible: true };
    },
    'about.faqs': function () {
      return { id: uid('faq'), question: '', answer: '', visible: true };
    }
  };

  function listAdd(path) {
    if (path === 'photos.items') {
      if (addGalleryPhoto('')) render({ preserveFocus: false });
      return;
    }
    var list = getPath(state.site, path) || [];
    list.push(TEMPLATES[path]());
    setPath(state.site, path, list);
    markDirty();
    render({ preserveFocus: false });
  }

  function listRemove(path, index) {
    var list = getPath(state.site, path) || [];
    list.splice(index, 1);
    markDirty();
    render({ preserveFocus: false });
  }

  function listMove(path, index, delta) {
    var list = getPath(state.site, path) || [];
    var next = index + delta;
    if (next < 0 || next >= list.length) return;
    var moved = list.splice(index, 1)[0];
    list.splice(next, 0, moved);
    markDirty();
    render({ preserveFocus: false });
  }

  // ------------------------------------------------------------- requests

  function loadSite() {
    return api('/admin/site').then(function (data) {
      state.site = data.site;
      state.stats = data.stats;
      state.flyer = data.flyer || null;
      state.sessions = data.sessions;
      state.usingDefaultPassword = data.usingDefaultPassword;
      state.apiKey = data.apiKey || null;
      state.storage = data.storage || '';
      state.baseline = data.site.meta && data.site.meta.updatedAt;
      markClean();
    });
  }

  function loadInstagram() {
    return api('/admin/instagram')
      .then(function (data) { state.instagram = data; })
      .catch(function () { state.instagram = { connected: false, canConnect: false }; });
  }

  /**
   * Meta sends the app user back to /admin?code=… after they approve. The code
   * is good for one hour and one use, so it is handed straight to the server
   * and wiped from the address bar — it should not sit in history or in a
   * shared screenshot.
   */
  function finishInstagramConnect() {
    var params = new URLSearchParams(location.search);
    var code = params.get('code');
    var denied = params.get('error');
    if (!code && !denied) return Promise.resolve();

    history.replaceState(null, '', location.pathname + location.hash);

    if (denied) {
      toast(params.get('error_description') || 'Instagram connection was cancelled.', 'error');
      return Promise.resolve();
    }
    return api('/admin/instagram', { method: 'POST', body: { code: code } })
      .then(function () {
        toast('Instagram connected.');
        return loadInstagram();
      })
      .catch(function (err) {
        toast(err.message || 'Could not connect Instagram.', 'error');
      });
  }

  /** Which integrations this deployment can actually see. Never blocks the panel. */
  function loadHealth() {
    return fetch('/healthz', { credentials: 'same-origin' })
      .then(function (res) { return res.json(); })
      .then(function (data) { state.health = data; })
      .catch(function () { state.health = null; });
  }

  function loadMedia() {
    return api('/admin/uploads').then(function (data) {
      state.media = data.files;
    });
  }

  function loadBackups() {
    return api('/admin/backups').then(function (data) {
      state.backups = data.backups;
    });
  }

  function save() {
    if (state.galleryBusy) { toast('Wait for the photos to finish uploading, then save.', 'info'); return Promise.resolve(); }
    if (state.saving) return Promise.resolve();
    state.saving = true;
    el.saveState.textContent = 'Saving…';
    el.saveState.className = 'save-state is-saving';
    el.save.disabled = true;
    el.revert.disabled = true;
    return api('/admin/site', { method: 'PUT', body: { site: state.site, expectedUpdatedAt: state.baseline } })
      .then(function (data) {
        state.site = data.site;
        state.stats = data.stats;
        state.baseline = data.site.meta && data.site.meta.updatedAt;
        markClean();
        toast('Changes published', 'ok');
        reloadPreview();
        return loadBackups().then(function () {
          if (state.section === 'data') render({ preserveFocus: false });
        });
      })
      .catch(function (err) {
        toast(err.message, 'error');
      })
      .then(function () {
        state.saving = false;
        markDirty();
      });
  }

  function reloadPreview() {
    if (el.preview.hidden) return;
    var url = el.previewFrame.getAttribute('src').split('?')[0];
    el.previewFrame.setAttribute('src', url + '?t=' + Date.now());
  }

  // Photos off a phone are several megabytes; nothing on the site needs that.
  // Shrinking in the browser keeps pages fast and fits the storage ceiling.
  var MAX_DIMENSION = 1800;
  var TARGET_BYTES = 560 * 1024;

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error('Could not read ' + file.name));
      };
      reader.readAsDataURL(file);
    });
  }

  function dataUrlBytes(dataUrl) {
    var comma = dataUrl.indexOf(',');
    return Math.round(((dataUrl.length - comma - 1) * 3) / 4);
  }

  function loadImage(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error('Not a readable image'));
      };
      img.src = dataUrl;
    });
  }

  /**
   * Resolves to { dataUrl, shrunk, from, to }. Never rejects.
   *
   * `alreadyRead` is a data URL that has been through the crop step, so the
   * file on disk is no longer what should be uploaded.
   */
  function prepareImage(file, alreadyRead) {
    var read = alreadyRead ? Promise.resolve(alreadyRead) : readAsDataUrl(file);
    return read.then(function (original) {
      var originalBytes = dataUrlBytes(original);
      // Vectors have no pixels to resample, and re-encoding a GIF would drop
      // its animation — leave both exactly as they are.
      if (!alreadyRead && /svg|gif/.test(file.type)) {
        return { dataUrl: original, shrunk: false, from: originalBytes, to: originalBytes };
      }

      return loadImage(original)
        .then(function (img) {
          var scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
          if (scale === 1 && originalBytes <= TARGET_BYTES) {
            return { dataUrl: original, shrunk: false, from: originalBytes, to: originalBytes };
          }

          var canvas = document.createElement('canvas');
          var context = canvas.getContext('2d');

          function encode(currentScale) {
            canvas.width = Math.max(1, Math.round(img.width * currentScale));
            canvas.height = Math.max(1, Math.round(img.height * currentScale));
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(img, 0, 0, canvas.width, canvas.height);
            // WebP keeps transparency and compresses hard; JPEG covers the rest.
            var probe = canvas.toDataURL('image/webp', 0.85);
            var type = probe.indexOf('data:image/webp') === 0 ? 'image/webp' : 'image/jpeg';
            var qualities = [0.85, 0.75, 0.65, 0.55, 0.45];
            for (var i = 0; i < qualities.length; i++) {
              var out = canvas.toDataURL(type, qualities[i]);
              if (dataUrlBytes(out) <= TARGET_BYTES) return out;
            }
            return canvas.toDataURL(type, 0.45);
          }

          var result = encode(scale);
          if (dataUrlBytes(result) > TARGET_BYTES) result = encode(scale * 0.7);
          // Re-encoding can occasionally cost more than it saves. If the file
          // already fits, keep whatever is smaller.
          if (dataUrlBytes(result) >= originalBytes && originalBytes <= TARGET_BYTES) {
            return { dataUrl: original, shrunk: false, from: originalBytes, to: originalBytes };
          }
          return { dataUrl: result, shrunk: true, from: originalBytes, to: dataUrlBytes(result) };
        })
        .catch(function () {
          return { dataUrl: original, shrunk: false, from: originalBytes, to: originalBytes };
        });
    });
  }

  /* ----------------------------------------------------------------- crop */

  /**
   * Choose the crop before the upload, rather than letting object-fit take
   * the edges off at display time.
   *
   * Resolves to a data URL to upload, or null to skip this file entirely.
   * The frame starts as the whole image, so confirming without touching it
   * is a no-op rather than a surprise.
   */
  var cropState = null;

  function cropElements() {
    return {
      modal: document.getElementById('crop-modal'),
      stage: document.getElementById('crop-stage'),
      image: document.getElementById('crop-image'),
      shade: document.getElementById('crop-shade'),
      box: document.getElementById('crop-box'),
      title: document.getElementById('crop-title'),
      size: document.getElementById('crop-size')
    };
  }

  /** Keep the frame inside the picture, and at the chosen shape if there is one. */
  function cropClamp() {
    var c = cropState;
    if (!c) return;
    var minSide = 24;
    c.w = Math.max(minSide, Math.min(c.w, c.dw));
    c.h = Math.max(minSide, Math.min(c.h, c.dh));
    if (c.ratio) {
      // Honour the shape, shrinking whichever side would otherwise escape.
      if (c.w / c.h > c.ratio) c.w = c.h * c.ratio;
      else c.h = c.w / c.ratio;
      if (c.w > c.dw) { c.w = c.dw; c.h = c.w / c.ratio; }
      if (c.h > c.dh) { c.h = c.dh; c.w = c.h * c.ratio; }
    }
    c.x = Math.max(0, Math.min(c.x, c.dw - c.w));
    c.y = Math.max(0, Math.min(c.y, c.dh - c.h));
  }

  function cropPaint() {
    var c = cropState;
    if (!c) return;
    var els = cropElements();
    var left = c.ox + c.x;
    var top = c.oy + c.y;
    els.box.style.left = left + 'px';
    els.box.style.top = top + 'px';
    els.box.style.width = c.w + 'px';
    els.box.style.height = c.h + 'px';
    els.shade.style.setProperty('--crop-x', left + 'px');
    els.shade.style.setProperty('--crop-y', top + 'px');
    els.shade.style.setProperty('--crop-w', c.w + 'px');
    els.shade.style.setProperty('--crop-h', c.h + 'px');
    var scale = c.natural.width / c.dw;
    els.size.textContent =
      Math.round(c.w * scale) + ' × ' + Math.round(c.h * scale) + ' pixels' +
      (Math.round(c.w) >= Math.round(c.dw) && Math.round(c.h) >= Math.round(c.dh)
        ? ' — the whole image'
        : '');
  }

  function cropReset(ratio) {
    var c = cropState;
    if (!c) return;
    c.ratio = ratio || 0;
    c.x = 0;
    c.y = 0;
    c.w = c.dw;
    c.h = c.dh;
    cropClamp();
    // A shape smaller than the picture is centred rather than hugging a corner.
    c.x = (c.dw - c.w) / 2;
    c.y = (c.dh - c.h) / 2;
    cropPaint();
  }

  function cropStep(file) {
    // A vector has no pixels to cut and re-encoding a GIF would drop its
    // animation, so neither is offered a crop.
    if (/svg|gif/.test(file.type)) return Promise.resolve({ dataUrl: null });

    return readAsDataUrl(file)
      .then(loadImage)
      .then(function (img) {
        var els = cropElements();
        if (!els.modal) return { dataUrl: null };

        return new Promise(function (resolve) {
          els.title.textContent = 'Crop ' + file.name;
          els.image.src = img.src;
          els.modal.hidden = false;

          // The rendered size is only known once it is on screen and laid out.
          var rect = els.image.getBoundingClientRect();
          var stage = els.stage.getBoundingClientRect();
          cropState = {
            img: img,
            natural: { width: img.naturalWidth, height: img.naturalHeight },
            dw: rect.width,
            dh: rect.height,
            ox: rect.left - stage.left,
            oy: rect.top - stage.top,
            ratio: 0,
            resolve: resolve
          };
          els.modal.querySelectorAll('[data-crop-ratio]').forEach(function (btn) {
            btn.setAttribute('aria-pressed', btn.getAttribute('data-crop-ratio') === '0' ? 'true' : 'false');
          });
          cropReset(0);
        });
      })
      .catch(function () {
        // An unreadable image is the upload's problem to report, not the crop's.
        return { dataUrl: null };
      });
  }

  function cropFinish(result) {
    var c = cropState;
    var els = cropElements();
    if (els.modal) els.modal.hidden = true;
    if (els.image) els.image.removeAttribute('src');
    cropState = null;
    if (c && c.resolve) c.resolve(result);
  }

  /** Cut the chosen rectangle at the image's own resolution. */
  function cropApply() {
    var c = cropState;
    if (!c) return;
    var scale = c.natural.width / c.dw;
    var sx = Math.round(c.x * scale);
    var sy = Math.round(c.y * scale);
    var sw = Math.max(1, Math.round(c.w * scale));
    var sh = Math.max(1, Math.round(c.h * scale));
    var canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    var context = canvas.getContext('2d');
    context.drawImage(c.img, sx, sy, sw, sh, 0, 0, sw, sh);
    var probe = canvas.toDataURL('image/webp', 0.92);
    var type = probe.indexOf('data:image/webp') === 0 ? 'image/webp' : 'image/jpeg';
    cropFinish({ dataUrl: canvas.toDataURL(type, 0.92), cropped: true });
  }

  function uploadFiles(files, onDone) {
    var queue = Array.prototype.slice.call(files).filter(function (f) {
      return /^image\//.test(f.type);
    });
    if (!queue.length) return;

    var uploaded = [];
    var saved = 0;
    var chain = queue.reduce(function (promise, file) {
      return promise.then(function () {
        return cropStep(file).then(function (choice) {
          if (choice && choice.skipped) return null;
          return prepareImage(file, choice && choice.dataUrl).then(function (prepared) {
            if (prepared.shrunk) saved += prepared.from - prepared.to;
            return api('/admin/uploads', {
              method: 'POST',
              body: { name: file.name, dataUrl: prepared.dataUrl }
            }).then(function (data) {
              uploaded.push(data.file);
            });
          });
        });
      });
    }, Promise.resolve());

    chain
      .then(function () {
        return loadMedia();
      })
      .then(function () {
        if (!uploaded.length) return;
        toast(
          uploaded.length + ' image' + (uploaded.length === 1 ? '' : 's') + ' uploaded' +
            (saved > 0 ? ' · ' + formatSize(saved) + ' saved by resizing' : ''),
          'ok'
        );
        if (onDone) onDone(uploaded[uploaded.length - 1]);
      })
      .catch(function (err) {
        toast(err.message, 'error');
        loadMedia().then(function () {
          renderMediaViews();
        });
      });
  }

  function renderMediaViews() {
    if (state.section === 'media') render({ preserveFocus: false });
    if (!el.mediaModal.hidden) renderMediaModal();
    renderSidebar();
  }

  function renderMediaModal() {
    el.modalGrid.innerHTML = state.media.length
      ? state.media
          .map(function (f) {
            return mediaCard(f, true);
          })
          .join('')
      : '<p class="empty">Nothing uploaded yet.</p>';
  }

  function openMediaModal(targetPath) {
    state.mediaTarget = targetPath;
    loadMedia().then(function () {
      renderMediaModal();
      el.mediaModal.hidden = false;
    });
  }

  function closeMediaModal() {
    el.mediaModal.hidden = true;
    state.mediaTarget = null;
  }

  // ---------------------------------------------------------------- events

  el.panel.addEventListener('input', function (event) {
    var target = event.target;
    if (!target.dataset || !target.dataset.path) return;
    var value;
    if (target.type === 'checkbox') value = target.checked;
    else if (target.type === 'number') value = parseInt(target.value, 10) || 0;
    else value = target.value;
    setPath(state.site, target.dataset.path, value);
    markDirty();

    if (target.dataset.titleSource) {
      var item = target.closest('.repeat-item');
      if (item) item.querySelector('.repeat-title').textContent = target.value || 'Untitled';
    }
    if (target.dataset.colorSync || target.dataset.colorText) {
      var partner = el.panel.querySelector(
        '[data-path="' + target.dataset.path + '"]' + (target.dataset.colorSync ? '[data-color-text]' : '[data-color-sync]')
      );
      if (partner && /^#[0-9a-fA-F]{6}$/.test(target.value)) partner.value = target.value;
    }
    if (target.dataset.imageInput) {
      var thumb = target.closest('.image-field').querySelector('.image-thumb');
      thumb.style.backgroundImage = target.value ? 'url(' + target.value + ')' : '';
      thumb.textContent = target.value ? '' : 'No image';
    }
  });

  el.panel.addEventListener('change', function (event) {
    if (event.target.id === 'ai-preset') {
      state.aiEditor = Object.assign({ id: state.aiEditor && state.aiEditor.id, enabled: state.aiEditor && state.aiEditor.enabled, preset: event.target.value }, AI_PRESETS[event.target.value]);
      render({ preserveFocus: false });
      return;
    }

    var target = event.target;
    if (target.dataset && target.dataset.path && target.dataset.rerender) render();
    if (target.dataset && target.dataset.galleryInput) {
      var galleryFiles = Array.from(target.files);
      target.value = '';
      uploadGalleryFiles(galleryFiles);
    }
    if (target.dataset && target.dataset.uploadInput) {
      uploadFiles(target.files, function () {
        renderMediaViews();
      });
      target.value = '';
    }
    if (target.dataset && target.dataset.flyerInput) {
      var flyerFile = target.files[0];
      target.value = '';
      postFlyer(flyerFile);
    }
    if (target.dataset && target.dataset.importInput) {
      if (state.galleryBusy) { target.value = ''; return toast('Finish uploading photos before replacing content.', 'info'); }
      var file = target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        if (state.galleryBusy) return toast('Finish uploading photos before replacing content.', 'info');
        var parsed;
        try {
          parsed = JSON.parse(reader.result);
        } catch (e) {
          return toast('That file is not valid JSON', 'error');
        }
        if (!confirm('Import this file? It replaces all current site content.')) return;
        api('/admin/import', { method: 'POST', body: { site: parsed } })
          .then(function (data) {
            state.site = data.site;
            state.stats = data.stats;
            state.baseline = data.site.meta && data.site.meta.updatedAt;
            markClean();
            toast('Content imported', 'ok');
            render({ preserveFocus: false });
            reloadPreview();
          })
          .catch(function (err) {
            toast(err.message, 'error');
          });
      };
      reader.readAsText(file);
      target.value = '';
    }
  });

  el.panel.addEventListener('submit', function (event) {
    if (event.target.id !== 'password-form') return;
    event.preventDefault();
    var current = document.getElementById('cur-pass').value;
    var next = document.getElementById('new-pass').value;
    api('/admin/password', { method: 'POST', body: { current: current, next: next } })
      .then(function () {
        toast('Password updated — sign in again', 'ok');
        setTimeout(function () {
          showLogin('Password changed. Sign in with the new one.');
        }, 900);
      })
      .catch(function (err) {
        toast(err.message, 'error');
      });
  });

  document.addEventListener('click', function (event) {
    var sideItem = event.target.closest('.side-item');
    if (sideItem) return go(sideItem.dataset.section);

    var trigger = event.target.closest('[data-action]');
    if (!trigger) return;
    var action = trigger.dataset.action;

    if (action === 'goto') return go(trigger.dataset.section);

    if (action === 'ai-edit' || action === 'ai-new') {
      state.aiEditor = action === 'ai-edit' ? Object.assign({ preset: 'custom' }, (state.flyer.providers || []).find(function (p) { return p.id === trigger.dataset.provider; })) : null;
      return render({ preserveFocus: false });
    }
    if (action === 'ai-size') {
      setFreeSize(trigger.dataset.size);
      render({ preserveFocus: false });
      return toast('Saved. The new model loads on the next generation.', 'ok');
    }
    if (action === 'ai-mode' || action === 'ai-move' || action === 'ai-save' || action === 'ai-remove') {
      var body = {}, method = 'PATCH';
      if (action === 'ai-mode') body.mode = trigger.dataset.mode;
      if (action === 'ai-move') {
        body.order = (state.flyer.providers || []).filter(function (p) { return p.configured; }).map(function (p) { return p.id; });
        var index = body.order.indexOf(trigger.dataset.provider), other = index + Number(trigger.dataset.dir);
        if (index < 0 || other < 0 || other >= body.order.length) return;
        var item = body.order[index]; body.order[index] = body.order[other]; body.order[other] = item;
      }
      if (action === 'ai-save') {
        method = 'POST';
        body = { provider: state.aiEditor && state.aiEditor.id || 'custom',
          label: document.getElementById('ai-label').value.trim(), model: document.getElementById('ai-model').value.trim(),
          protocol: document.getElementById('ai-protocol').value, baseUrl: document.getElementById('ai-url').value.trim(),
          apiKey: document.getElementById('ai-key').value.trim(), enabled: document.getElementById('ai-enabled').checked };
      }
      if (action === 'ai-remove') { method = 'DELETE'; body.provider = trigger.dataset.provider; }
      trigger.disabled = true;
      return api('/admin/ai-provider', { method: method, body: body }).then(function (data) {
        state.flyer = data;
        state.aiEditor = null;
        render({ preserveFocus: false });
        toast(action === 'ai-save' ? (data.mode === 'hosted' ? 'Provider saved.' : 'Provider saved. Choose Use my APIs to enable API generation.') : 'AI settings saved.', 'ok');
      }).catch(function (err) { toast(err.message, 'error'); }).finally(function () { trigger.disabled = false; });
    }

    if (action === 'seo-generate') {
      var target = trigger.dataset.target;
      var input = document.getElementById(target) || trigger.closest('.field, .cell, .mini-field');
      if (input && !('value' in input)) input = input.querySelector('[data-path]');
      var original = input ? input.value : String(getPath(state.site, target) || '');
      var rowPath = /^(?:about\.faqs|links\.items|shows|reels\.items|photos\.items)\.\d+/.exec(target);
      var originalRowId = rowPath ? getPath(state.site, rowPath[0] + '.id') : null;
      if (!original.trim()) return toast('Write something first, then generate SEO + GEO.', 'error');
      var idleLabel = trigger.textContent;
      var idleTitle = trigger.title;
      var progress = document.createElement('small');
      progress.className = 'hint';
      progress.setAttribute('role', 'status');
      trigger.parentElement.appendChild(progress);
      var compact = trigger.parentElement && trigger.parentElement.classList.contains('is-compact');
      trigger.disabled = true;
      trigger.textContent = compact ? '…' : 'Generating SEO + GEO…';
      return Promise.resolve().then(function () {
        return window.CopyEditor.rewrite({
          site: JSON.parse(JSON.stringify(state.site)), path: target, text: original,
          label: trigger.dataset.label || 'Text', recent: recentRewrites.slice(), generate: generateAI,
          onProgress: function (message) { trigger.textContent = compact ? 'Working…' : 'Generating SEO + GEO…'; progress.textContent = message; }
        });
      })
        .then(function (data) {
          if (!data.changed) return toast('No useful new version was generated. Your original was kept.', 'info');
          var latest = Array.from(document.querySelectorAll('[data-path]')).find(function (node) { return node.dataset.path === target; }) || document.getElementById(target);
          if ((rowPath && getPath(state.site, rowPath[0] + '.id') !== originalRowId) || String(getPath(state.site, target) || '') !== original || (latest && latest.value !== original)) {
            throw new Error('This field changed while AI was working. Your newer text was kept.');
          }
          if (latest) latest.value = data.text;
          setPath(state.site, target, data.text);
          recentRewrites.push({ path: target, text: data.text });
          recentRewrites = recentRewrites.slice(-6);
          markDirty();
          render({ preserveFocus: false });
          toast('SEO + GEO applied together. Review it, then save.', 'ok');
        })
        .catch(function (err) { toast(err.message || 'Could not generate SEO copy.', 'error'); })
        .finally(function () {
          trigger.disabled = false;
          trigger.textContent = idleLabel;
          trigger.title = idleTitle;
          progress.remove();
        });
    }

    if (action === 'seo-photo') {
      var photoTarget = trigger.dataset.target;
      var imageUrl = String(getPath(state.site, trigger.dataset.imagePath) || '');
      trigger.disabled = true;
      trigger.textContent = 'Analyzing…';
      var originalAlt = String(getPath(state.site, photoTarget) || '');
      var originalImagePath = trigger.dataset.imagePath;
      var photoRow = /^(?:photos\.items|shows|reels\.items)\.\d+/.exec(originalImagePath);
      var photoRowId = photoRow && getPath(state.site, photoRow[0] + '.id');
      return fetch(imageUrl, { credentials: 'same-origin' })
        .then(function (response) { if (!response.ok) throw new Error('Could not load that photo. Choose an uploaded image.'); return response.blob(); })
        .then(function (blob) { if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) throw new Error('Use a PNG, JPEG, WebP or GIF photo.'); return readAsDataUrl(blob); })
        .then(function (dataUrl) {
          return freeImageGeneration(dataUrl,
            'Write factual accessible alt text for this image on Taylor Drew’s official website, useful for image search (SEO) and AI answers (GEO). Describe only what is visible. Do not guess identities or locations, invent credits, or stuff keywords. For a flyer include its clearly visible event details. Return JSON with a text property, one concise sentence within 160 characters.',
            { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
            function (message) { trigger.textContent = String(message); }
          );
        })
        .then(function (data) {
          if (!data || typeof data.text !== 'string' || !data.text.trim()) throw new Error('No usable description was generated. Your original was kept.');
          if ((photoRow && getPath(state.site, photoRow[0] + '.id') !== photoRowId) || String(getPath(state.site, photoTarget) || '') !== originalAlt || String(getPath(state.site, originalImagePath) || '') !== imageUrl) throw new Error('This photo or description changed while AI was running. Your edits were kept.');
          setPath(state.site, photoTarget, data.text.trim().slice(0, /^photos\.items\.\d+\.photoAlt$/.test(photoTarget) ? 500 : 160));
          markDirty();
          render({ preserveFocus: false });
          toast('Photo SEO + GEO description added. Review it, then save.', 'ok');
        })
        .catch(function (err) {
          trigger.disabled = false;
          trigger.textContent = 'Generate photo SEO + GEO';
          toast(err.message || 'Could not analyze the photo.', 'error');
        });
    }

    if (action === 'identity-fix') {
      setPath(state.site, trigger.dataset.target, trigger.dataset.value || '');
      markDirty();
      render({ preserveFocus: false });
      return toast('Set. Review it, then save.', 'ok');
    }

    if (action === 'show-filter') {
      state.showFilter = trigger.dataset.filter;
      return render({ preserveFocus: false });
    }
    if (action === 'toggle-show') {
      var id = trigger.dataset.id;
      state.expandedShows[id] = !state.expandedShows[id];
      return render({ preserveFocus: false });
    }
    if (action === 'sort-links') {
      state.site.links.items = (state.site.links.items || []).slice().sort(function (a, b) {
        return (Number(b.clicks) || 0) - (Number(a.clicks) || 0);
      });
      markDirty();
      toast('Sorted by clicks — save to keep it', 'info');
      return render({ preserveFocus: false });
    }
    if (action === 'sort-shows') {
      // Undated shows sort last rather than jumping to the front.
      state.site.shows = (state.site.shows || []).slice().sort(function (a, b) {
        return String(a.date || '9999-99-99').localeCompare(String(b.date || '9999-99-99'));
      });
      markDirty();
      toast('Sorted by date — save to keep it', 'info');
      return render({ preserveFocus: false });
    }
    if (action === 'ig-copy-redirect') {
      var value = trigger.dataset.value || '';
      var done = function () { toast('Redirect URI copied.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(value).then(done, function () {
          toast('Copy it by hand: ' + value, 'info');
        });
      }
      toast('Copy it by hand: ' + value, 'info');
      return;
    }
    if (action === 'ig-save-app') {
      var idBox = document.getElementById('ig-app-id');
      var secretBox = document.getElementById('ig-app-secret');
      var dmBox = document.getElementById('ig-messaging');
      return api('/admin/instagram/app', {
        method: 'POST',
        body: {
          appId: idBox ? idBox.value.trim() : '',
          appSecret: secretBox ? secretBox.value.trim() : '',
          messaging: dmBox ? dmBox.checked : undefined
        }
      })
        .then(function () {
          toast('App details saved.');
          return loadInstagram();
        })
        .then(function () { render({ preserveFocus: false }); })
        .catch(function (err) { toast(err.message || 'Could not save the app details.', 'error'); });
    }
    if (action === 'apikey-create') {
      var labelBox = document.getElementById('apikey-label');
      var label = labelBox ? labelBox.value.trim() : '';
      if (state.apiKey && state.apiKey.set &&
          !confirm('Replace the current key? Anything using the old one stops working straight away.')) {
        return;
      }
      return api('/admin/apikey', { method: 'POST', body: { label: label } })
        .then(function (data) {
          state.freshApiKey = data.key;
          toast('Key made. Copy it now — it is not shown again.');
          return loadSite();
        })
        .then(function () { render({ preserveFocus: false }); })
        .catch(function (err) { toast(err.message || 'Could not make a key.', 'error'); });
    }
    if (action === 'apikey-revoke') {
      if (!confirm('Revoke the API key? Anything using it stops working straight away.')) return;
      return api('/admin/apikey', { method: 'DELETE' })
        .then(function () {
          state.freshApiKey = '';
          toast('Key revoked.');
          return loadSite();
        })
        .then(function () { render({ preserveFocus: false }); })
        .catch(function (err) { toast(err.message || 'Could not revoke it.', 'error'); });
    }
    if (action === 'ig-save-token') {
      var tokenBox = document.getElementById('ig-token');
      return api('/admin/instagram/token', {
        method: 'POST',
        body: { token: tokenBox ? tokenBox.value.trim() : '' }
      })
        .then(function (out) {
          toast('Token saved' + (out && out.username ? ' — connected as @' + out.username : '') + '.');
          if (tokenBox) tokenBox.value = '';
          return loadInstagram();
        })
        .then(function () { render({ preserveFocus: false }); })
        .catch(function (err) { toast(err.message || 'Could not save that token.', 'error'); });
    }
    if (action === 'ig-send-dm') {
      var toBox = document.getElementById('ig-dm-to');
      var textBox = document.getElementById('ig-dm-text');
      return api('/admin/instagram/message', {
        method: 'POST',
        body: { recipientId: toBox ? toBox.value.trim() : '', text: textBox ? textBox.value : '' }
      })
        .then(function () {
          toast('Message sent.');
          if (textBox) textBox.value = '';
        })
        .catch(function (err) { toast(err.message || 'Could not send the message.', 'error'); });
    }
    if (action === 'ig-forget-app') {
      if (!confirm('Forget the Instagram app ID and secret?')) return;
      return api('/admin/instagram/app', { method: 'DELETE' })
        .then(function () {
          toast('App details removed.');
          return loadInstagram();
        })
        .then(function () { render({ preserveFocus: false }); })
        .catch(function (err) { toast(err.message || 'Could not remove them.', 'error'); });
    }
    if (action === 'ig-disconnect') {
      if (!confirm('Disconnect Instagram? /reels will fall back to the pinned reels.')) return;
      return api('/admin/instagram', { method: 'DELETE' })
        .then(function () {
          toast('Instagram disconnected.');
          return loadInstagram();
        })
        .then(function () { render({ preserveFocus: false }); })
        .catch(function (err) { toast(err.message || 'Could not disconnect.', 'error'); });
    }
    if (action === 'list-add') return listAdd(trigger.dataset.list);
    if (action === 'list-remove') {
      if (!confirm('Delete this item?')) return;
      return listRemove(trigger.dataset.list, Number(trigger.dataset.index));
    }
    if (action === 'list-move') return listMove(trigger.dataset.list, Number(trigger.dataset.index), Number(trigger.dataset.dir));

    if (action === 'pick-image') return openMediaModal(trigger.dataset.target);
    if (action === 'gallery-add-media') {
      if (addGalleryPhoto(trigger.dataset.url)) { go('photos'); toast('Photo added. Add its description, then save.', 'ok'); }
      return;
    }
    if (action === 'clear-image') {
      setPath(state.site, trigger.dataset.target, '');
      markDirty();
      return render({ preserveFocus: false });
    }
    if (action === 'choose-media') {
      if (state.mediaTarget) {
        setPath(state.site, state.mediaTarget, trigger.dataset.url);
        markDirty();
        closeMediaModal();
        render({ preserveFocus: false });
        toast('Image selected — remember to save', 'info');
      }
      return;
    }
    if (action === 'copy-media') {
      var url = location.origin + trigger.dataset.url;
      if (navigator.clipboard) navigator.clipboard.writeText(url);
      return toast('URL copied: ' + trigger.dataset.url, 'ok');
    }
    if (action === 'delete-media') {
      var inUse = mediaUsage('/uploads/' + trigger.dataset.name);
      var warning = inUse.length
        ? 'This image is in use as: ' + inUse.join(', ') + '.\n\nDelete it anyway? Those slots fall back to the placeholder.'
        : 'Delete ' + trigger.dataset.name + '?';
      if (!confirm(warning)) return;
      return api('/admin/uploads/' + encodeURIComponent(trigger.dataset.name), { method: 'DELETE' })
        .then(loadMedia)
        .then(function () {
          renderMediaViews();
          toast('Image deleted', 'ok');
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
    }

    if (state.galleryBusy && ['reset-analytics', 'restore-backup', 'reset-site'].includes(action)) return toast('Finish uploading photos before replacing content.', 'info');
    if (action === 'reset-analytics') {
      if (!confirm('Reset every link click count to zero?')) return;
      return api('/admin/analytics/reset', { method: 'POST' })
        .then(function (data) {
          state.site = data.site;
          state.stats = data.stats;
          state.baseline = data.site.meta && data.site.meta.updatedAt;
          markClean();
          render({ preserveFocus: false });
          toast('Click counts reset', 'ok');
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
    }

    if (action === 'export') {
      window.open('/api/admin/export', '_blank');
      return;
    }

    if (action === 'restore-backup') {
      if (!confirm('Restore ' + trigger.dataset.name + '? Current content is snapshotted first.')) return;
      return api('/admin/backups/restore', { method: 'POST', body: { name: trigger.dataset.name } })
        .then(function (data) {
          state.site = data.site;
          state.stats = data.stats;
          state.baseline = data.site.meta && data.site.meta.updatedAt;
          markClean();
          return loadBackups();
        })
        .then(function () {
          render({ preserveFocus: false });
          reloadPreview();
          toast('Snapshot restored', 'ok');
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
    }

    if (action === 'reset-site') {
      if (!confirm('Reset every page back to the starting content? This cannot be undone except from a snapshot.')) return;
      return api('/admin/site/reset', { method: 'POST' })
        .then(function (data) {
          state.site = data.site;
          state.stats = data.stats;
          state.baseline = data.site.meta && data.site.meta.updatedAt;
          markClean();
          return loadBackups();
        })
        .then(function () {
          render({ preserveFocus: false });
          reloadPreview();
          toast('Site reset to defaults', 'ok');
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
    }

    if (action === 'revoke-sessions') {
      if (!confirm('Sign out of every device, including this one?')) return;
      return api('/admin/sessions', { method: 'DELETE' }).then(function () {
        showLogin('Signed out everywhere.');
      });
    }
  });

  // drag to reorder
  var dragFrom = null;
  el.panel.addEventListener('dragstart', function (event) {
    var item = event.target.closest('[data-sortable-item]');
    if (!item) return;
    dragFrom = item;
    item.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', item.dataset.index);
    } catch (e) {
      /* Safari */
    }
  });

  el.panel.addEventListener('dragover', function (event) {
    var item = event.target.closest('[data-sortable-item]');
    if (!item || !dragFrom || item.dataset.list !== dragFrom.dataset.list) return;
    event.preventDefault();
    item.classList.add('is-drop-target');
  });

  el.panel.addEventListener('dragleave', function (event) {
    var item = event.target.closest('[data-sortable-item]');
    if (item) item.classList.remove('is-drop-target');
  });

  /* Crop: dragging the frame, dragging a corner, and the three ways out. */
  (function wireCrop() {
    var modal = document.getElementById('crop-modal');
    if (!modal) return;
    var stage = document.getElementById('crop-stage');
    var drag = null;

    function pointIn(event) {
      var rect = stage.getBoundingClientRect();
      return { x: event.clientX - rect.left - cropState.ox, y: event.clientY - rect.top - cropState.oy };
    }

    stage.addEventListener('pointerdown', function (event) {
      if (!cropState) return;
      var handle = event.target.closest('[data-crop-handle]');
      var onBox = event.target.closest('.crop-box');
      if (!handle && !onBox) return;
      event.preventDefault();
      var at = pointIn(event);
      drag = {
        handle: handle ? handle.getAttribute('data-crop-handle') : null,
        fromX: at.x,
        fromY: at.y,
        box: { x: cropState.x, y: cropState.y, w: cropState.w, h: cropState.h }
      };
      event.target.setPointerCapture(event.pointerId);
    });

    stage.addEventListener('pointermove', function (event) {
      if (!drag || !cropState) return;
      event.preventDefault();
      var at = pointIn(event);
      var dx = at.x - drag.fromX;
      var dy = at.y - drag.fromY;
      var b = drag.box;

      if (!drag.handle) {
        cropState.x = b.x + dx;
        cropState.y = b.y + dy;
        cropClamp();
        cropPaint();
        return;
      }

      // Each corner moves its own two edges; the opposite corner stays put.
      var left = b.x;
      var top = b.y;
      var right = b.x + b.w;
      var bottom = b.y + b.h;
      if (drag.handle.indexOf('w') > -1) left = b.x + dx;
      if (drag.handle.indexOf('e') > -1) right = b.x + b.w + dx;
      if (drag.handle.indexOf('n') > -1) top = b.y + dy;
      if (drag.handle.indexOf('s') > -1) bottom = b.y + b.h + dy;

      cropState.x = Math.min(left, right);
      cropState.y = Math.min(top, bottom);
      cropState.w = Math.abs(right - left);
      cropState.h = Math.abs(bottom - top);
      cropClamp();
      cropPaint();
    });

    function endDrag(event) {
      if (!drag) return;
      drag = null;
      if (event.target.releasePointerCapture) {
        try { event.target.releasePointerCapture(event.pointerId); } catch (_) {}
      }
    }
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    modal.addEventListener('click', function (event) {
      var ratio = event.target.closest('[data-crop-ratio]');
      if (ratio) {
        modal.querySelectorAll('[data-crop-ratio]').forEach(function (btn) {
          btn.setAttribute('aria-pressed', btn === ratio ? 'true' : 'false');
        });
        cropReset(Number(ratio.getAttribute('data-crop-ratio')) || 0);
        return;
      }
      if (event.target.closest('[data-crop-apply]')) return cropApply();
      // The whole image: uploaded as it came, with no re-encode from here.
      if (event.target.closest('[data-crop-whole]')) return cropFinish({ dataUrl: null });
      if (event.target.closest('[data-crop-cancel]')) return cropFinish({ skipped: true });
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && cropState) cropFinish({ skipped: true });
    });
  })();

  el.panel.addEventListener('drop', function (event) {
    var item = event.target.closest('[data-sortable-item]');
    if (!item || !dragFrom || item.dataset.list !== dragFrom.dataset.list) return;
    event.preventDefault();
    var from = Number(dragFrom.dataset.index);
    var to = Number(item.dataset.index);
    if (from !== to) {
      var list = getPath(state.site, item.dataset.list);
      var moved = list.splice(from, 1)[0];
      list.splice(to, 0, moved);
      markDirty();
    }
    render({ preserveFocus: false });
  });

  el.panel.addEventListener('dragend', function () {
    if (dragFrom) dragFrom.classList.remove('is-dragging');
    dragFrom = null;
    el.panel.querySelectorAll('.is-drop-target').forEach(function (n) {
      n.classList.remove('is-drop-target');
    });
  });

  // drag-and-drop a flyer onto the shows page
  el.panel.addEventListener('dragover', function (event) {
    var drop = event.target.closest('[data-flyer-drop]');
    if (!drop) return;
    event.preventDefault();
    drop.classList.add('is-over');
  });

  el.panel.addEventListener('dragleave', function (event) {
    var drop = event.target.closest('[data-flyer-drop]');
    if (drop) drop.classList.remove('is-over');
  });

  el.panel.addEventListener('drop', function (event) {
    var drop = event.target.closest('[data-flyer-drop]');
    if (!drop || !event.dataTransfer.files.length) return;
    event.preventDefault();
    drop.classList.remove('is-over');
    postFlyer(event.dataTransfer.files[0]);
  });

  // drag-and-drop upload onto the drop zone
  el.panel.addEventListener('dragover', function (event) {
    if (event.target.closest('[data-gallery-drop]')) event.preventDefault();
  });
  el.panel.addEventListener('drop', function (event) {
    if (!event.target.closest('[data-gallery-drop]') || !event.dataTransfer.files.length) return;
    event.preventDefault();
    uploadGalleryFiles(event.dataTransfer.files);
  });

  el.panel.addEventListener('dragover', function (event) {
    var drop = event.target.closest('[data-upload-drop]');
    if (!drop) return;
    event.preventDefault();
    drop.classList.add('is-over');
  });

  el.panel.addEventListener('drop', function (event) {
    var drop = event.target.closest('[data-upload-drop]');
    if (!drop || !event.dataTransfer.files.length) return;
    event.preventDefault();
    drop.classList.remove('is-over');
    uploadFiles(event.dataTransfer.files, function () {
      renderMediaViews();
    });
  });

  el.modalUploadInput.addEventListener('change', function () {
    uploadFiles(this.files, function (file) {
      renderMediaModal();
      if (file && state.mediaTarget) {
        setPath(state.site, state.mediaTarget, file.url);
        markDirty();
        closeMediaModal();
        render({ preserveFocus: false });
      }
    });
    this.value = '';
  });

  el.mediaModal.addEventListener('click', function (event) {
    if (event.target.closest('[data-close-modal]') || event.target === el.mediaModal) closeMediaModal();
    if (event.target.id === 'media-clear' && state.mediaTarget) {
      setPath(state.site, state.mediaTarget, '');
      markDirty();
      closeMediaModal();
      render({ preserveFocus: false });
    }
  });

  el.save.addEventListener('click', save);

  el.revert.addEventListener('click', function () {
    if (state.galleryBusy) return toast('Finish uploading photos before discarding changes.', 'info');
    if (state.dirty && !confirm('Discard unsaved changes?')) return;
    loadSite().then(function () {
      render({ preserveFocus: false });
      toast('Reloaded from the server', 'info');
    });
  });

  el.previewToggle.addEventListener('click', function () {
    el.preview.hidden = !el.preview.hidden;
    el.workspaceBody.classList.toggle('with-preview', !el.preview.hidden);
    el.previewToggle.textContent = el.preview.hidden ? 'Preview' : 'Hide preview';
    if (!el.preview.hidden) reloadPreview();
  });

  document.getElementById('preview-reload').addEventListener('click', reloadPreview);

  document.getElementById('preview-tabs').addEventListener('click', function (event) {
    var tab = event.target.closest('.preview-tab');
    if (!tab) return;
    this.querySelectorAll('.preview-tab').forEach(function (t) {
      t.classList.toggle('is-active', t === tab);
    });
    el.previewFrame.setAttribute('src', tab.dataset.preview + '?t=' + Date.now());
  });

  document.getElementById('nav-toggle').addEventListener('click', function () {
    el.app.classList.toggle('nav-open');
  });

  // On a phone the drawer covers the panel, so a tap on what is left of it,
  // or Escape, is the expected way out.
  el.app.addEventListener('click', function (event) {
    if (!el.app.classList.contains('nav-open')) return;
    if (event.target.closest('.sidebar') || event.target.closest('#nav-toggle')) return;
    el.app.classList.remove('nav-open');
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') el.app.classList.remove('nav-open');
  });

  document.getElementById('sign-out').addEventListener('click', function () {
    if (state.galleryBusy) return toast('Finish uploading photos before signing out.', 'info');
    if (state.dirty && !confirm('You have unsaved changes. Sign out anyway?')) return;
    api('/logout', { method: 'POST' }).then(function () {
      showLogin('Signed out.');
    });
  });

  document.addEventListener('keydown', function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!state.site) return;
      if (state.dirty) save();
      else toast('Nothing to save', 'info');
    }
    if (event.key === 'Escape' && !el.mediaModal.hidden) closeMediaModal();
  });

  window.addEventListener('beforeunload', function (event) {
    if (!state.dirty && !state.galleryBusy) return;
    event.preventDefault();
    event.returnValue = '';
  });

  window.addEventListener('hashchange', function () {
    var id = location.hash.slice(1);
    if (RENDERERS[id] && id !== state.section) go(id);
  });

  // ----------------------------------------------------------------- boot

  el.loginForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var button = document.getElementById('login-submit');
    button.disabled = true;
    el.loginError.hidden = true;
    api('/login', { method: 'POST', body: { password: el.password.value } })
      .then(function (data) {
        state.csrf = data.csrf;
        state.usingDefaultPassword = data.usingDefaultPassword;
        el.password.value = '';
        return start();
      })
      .catch(function (err) {
        el.loginError.textContent = err.message;
        el.loginError.hidden = false;
      })
      .then(function () {
        button.disabled = false;
      });
  });

  function showLogin(message) {
    state.site = null;
    state.csrf = null;
    state.dirty = false;
    el.app.hidden = true;
    el.login.hidden = false;
    if (message) {
      el.loginError.textContent = message;
      el.loginError.hidden = false;
    }
    setTimeout(function () {
      el.password.focus();
    }, 30);
  }

  function start() {
    return Promise.all([loadSite(), loadMedia(), loadBackups(), loadHealth(), loadInstagram()]).then(function () {
      el.login.hidden = true;
      el.app.hidden = false;
      var hash = location.hash.slice(1);
      state.section = RENDERERS[hash] ? hash : 'overview';
      render({ preserveFocus: false });
      // Meta may have just sent us back here with a code to redeem.
      return finishInstagramConnect().then(function () {
        if (state.section === 'reels') render({ preserveFocus: false });
      });
    });
  }

  api('/session')
    .then(function (data) {
      if (data.signedIn) {
        state.csrf = data.csrf;
        return start();
      }
      showLogin();
    })
    .catch(function () {
      showLogin();
    });
})();
