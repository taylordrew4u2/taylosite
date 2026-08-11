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
    mediaTarget: null,
    showFilter: 'all',
    expandedShows: {}
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
    footer: '<rect x="1.5" y="1.5" width="13" height="13"/><path d="M1.5 11h13"/>',
    media: '<rect x="1.5" y="2.5" width="13" height="11"/><circle cx="5.5" cy="6" r="1.2"/><path d="M2 12l3.5-3.5 3 3L11 8l3 3.5"/>',
    data: '<path d="M2 5h9l-2-2M14 11H5l2 2"/><path d="M2 5l2-2M14 11l-2 2"/>',
    security: '<rect x="3" y="7" width="10" height="7.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'
  };

  var SECTIONS = [
    { id: 'overview', label: 'Overview', hint: 'Everything at a glance.' },
    { id: 'brand', label: 'Brand & SEO', hint: 'Name, contact details and search listing.', keys: ['brand', 'seo'] },
    { id: 'home', label: 'Home page', hint: 'The hero, the photo and the upcoming block.', keys: ['home'] },
    { id: 'links', label: 'Links', hint: 'Every link, in the order they appear.', keys: ['links'] },
    { id: 'shows', label: 'Shows', hint: 'Tour dates shown on the home and links pages.', keys: ['shows'] },
    { id: 'about', label: 'About page', hint: 'Bio, facts and press quotes.', keys: ['about'] },
    { id: 'nav', label: 'Navigation', hint: 'The menu in the header.', keys: ['nav'] },
    { id: 'themes', label: 'Themes', hint: 'The colours the site is built from.', keys: ['themes'] },
    { id: 'footer', label: 'Footer', hint: 'The line at the bottom of every page.', keys: ['footer'] },
    { id: 'media', label: 'Media', hint: 'Uploaded images.' },
    { id: 'data', label: 'Backups & data', hint: 'Snapshots, export, import and reset.' },
    { id: 'security', label: 'Security', hint: 'Password and signed-in devices.' }
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

  function field(opts) {
    var value = opts.value == null ? '' : opts.value;
    return (
      '<div class="field">' +
      '<label class="label" for="' + esc(opts.path) + '">' + esc(opts.label) + '</label>' +
      '<input class="input" id="' + esc(opts.path) + '" type="' + (opts.type || 'text') + '"' +
      ' data-path="' + esc(opts.path) + '"' +
      (opts.titleSource ? ' data-title-source="1"' : '') +
      (opts.attrs || '') +
      ' placeholder="' + esc(opts.placeholder || '') + '" value="' + esc(value) + '">' +
      (opts.hint ? '<span class="hint">' + esc(opts.hint) + '</span>' : '') +
      '</div>'
    );
  }

  function textareaField(opts) {
    return (
      '<div class="field">' +
      '<label class="label" for="' + esc(opts.path) + '">' + esc(opts.label) + '</label>' +
      '<textarea class="textarea" id="' + esc(opts.path) + '" data-path="' + esc(opts.path) + '"' +
      (opts.rows ? ' rows="' + opts.rows + '"' : '') +
      ' placeholder="' + esc(opts.placeholder || '') + '">' + esc(opts.value || '') + '</textarea>' +
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
    return (
      '<div class="field">' +
      '<span class="label">' + esc(opts.label) + '</span>' +
      '<div class="image-field">' +
      '<span class="image-thumb"' + (value ? ' style="background-image:url(' + esc(value) + ')"' : '') + '>' +
      (value ? '' : 'No image') +
      '</span>' +
      '<span class="image-controls">' +
      '<input class="input" type="text" data-path="' + esc(opts.path) + '" data-image-input="1" placeholder="/uploads/photo.jpg" value="' + esc(value) + '">' +
      '<span class="image-buttons">' +
      '<button class="btn btn-sm" type="button" data-action="pick-image" data-target="' + esc(opts.path) + '">Choose or upload</button>' +
      (value ? '<button class="btn btn-sm btn-danger" type="button" data-action="clear-image" data-target="' + esc(opts.path) + '">Remove</button>' : '') +
      '</span>' +
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
          '</div>'
      ) +
      card(
        'Search & sharing',
        field({ label: 'Page title', path: 'seo.title', value: site.seo.title, hint: 'Shown in the browser tab and in Google results.' }) +
          textareaField({ label: 'Description', path: 'seo.description', value: site.seo.description, rows: 3, hint: 'Around 150 characters works best.' }) +
          '<div class="grid-2">' +
          imageField({ label: 'Social share image', path: 'seo.ogImage', value: site.seo.ogImage, hint: '1200 × 630 is ideal.' }) +
          imageField({ label: 'Favicon', path: 'seo.favicon', value: site.seo.favicon, hint: 'A small square image.' }) +
          '</div>'
      )
    );
  }

  function sectionHome() {
    var home = state.site.home;
    return (
      card(
        'Hero',
        field({ label: 'Kicker', path: 'home.kicker', value: home.kicker, hint: 'Small line above the name.' }) +
          field({ label: 'Big headline', path: 'home.headline', value: home.headline, hint: 'Each word stacks on its own line.' }) +
          field({ label: 'Subhead', path: 'home.subhead', value: home.subhead }) +
          imageField({ label: 'Hero photo', path: 'home.photo', value: home.photo }) +
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
                      '<label class="mini-field"><span>Button label</span><input class="input input-sm" type="text" data-path="shows.' + i + '.ctaLabel" value="' + esc(show.ctaLabel || '') + '" placeholder="Tickets"></label>' +
                      '<label class="mini-field mini-field-wide"><span>Note</span><input class="input input-sm" type="text" data-path="shows.' + i + '.note" value="' + esc(show.note || '') + '" placeholder="Late show · 18+"></label>' +
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
      stats +
      card('Tour dates', body, {
        subtitle: 'Past dates leave the home page on their own and move to the bottom of the links page.',
        actions:
          '<div class="chips">' + filters + '</div>' +
          '<button class="btn btn-sm" type="button" data-action="sort-shows" title="Order by date, soonest first">Sort by date</button>' +
          '<button class="btn btn-sm btn-accent" type="button" data-action="list-add" data-list="shows">Add show</button>'
      })
    );
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
      ' aria-label="' + esc(label) + '" placeholder="' + esc(placeholder || '') + '" value="' + esc(value || '') + '"></label>'
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

    return (
      card(
        'Header',
        '<div class="grid-2">' +
          field({ label: 'Kicker', path: 'about.kicker', value: about.kicker }) +
          field({ label: 'Title', path: 'about.title', value: about.title, hint: 'Each word stacks on its own line.' }) +
          '</div>' +
          imageField({ label: 'Photo', path: 'about.photo', value: about.photo }) +
          field({ label: 'Photo alt text', path: 'about.photoAlt', value: about.photoAlt })
      ) +
      card('Bio', paragraphs, {
        actions: '<button class="btn btn-sm btn-accent" type="button" data-action="list-add" data-list="about.body">Add paragraph</button>'
      }) +
      card('Facts', facts, {
        subtitle: 'Small label / value pairs beside the bio.',
        actions: '<button class="btn btn-sm btn-accent" type="button" data-action="list-add" data-list="about.facts">Add fact</button>'
      }) +
      card('Press quotes', quotes, {
        actions: '<button class="btn btn-sm btn-accent" type="button" data-action="list-add" data-list="about.quotes">Add quote</button>'
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

  /** Where an uploaded image is currently used, so nothing vanishes by surprise. */
  var MEDIA_SLOTS = [
    { path: 'home.photo', label: 'Hero photo' },
    { path: 'about.photo', label: 'About photo' },
    { path: 'seo.ogImage', label: 'Share image' },
    { path: 'seo.favicon', label: 'Favicon' }
  ];

  function mediaUsage(url) {
    if (!state.site) return [];
    return MEDIA_SLOTS.filter(function (slot) {
      return getPath(state.site, slot.path) === url;
    }).map(function (slot) {
      return slot.label;
    });
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
        : '<button class="btn btn-sm" type="button" data-action="copy-media" data-url="' + esc(file.url) + '">Copy URL</button>') +
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
      card(
        'Signed-in devices',
        '<table class="table"><thead><tr><th>Session</th><th>Signed in</th><th>IP</th><th>Browser</th></tr></thead><tbody>' + rows + '</tbody></table>',
        { actions: '<button class="btn btn-sm btn-danger" type="button" data-action="revoke-sessions">Sign out everywhere</button>' }
      )
    );
  }

  var RENDERERS = {
    overview: sectionOverview,
    brand: sectionBrand,
    home: sectionHome,
    links: sectionLinks,
    shows: sectionShows,
    about: sectionAbout,
    nav: sectionNav,
    themes: sectionThemes,
    footer: sectionFooter,
    media: sectionMedia,
    data: sectionData,
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
      media: state.media.length
    };
    var changed = changedSections();
    el.nav.innerHTML = SECTIONS.map(function (s) {
      return (
        '<button class="side-item' + (s.id === state.section ? ' is-active' : '') +
        (changed[s.id] ? ' is-changed' : '') + '" type="button" data-section="' + s.id + '"' +
        (changed[s.id] ? ' title="Unsaved changes in this section"' : '') + '>' +
        icon(ICONS[s.id]) + '<span>' + esc(s.label) + '</span>' +
        (changed[s.id] ? '<span class="side-dot" aria-label="unsaved changes"></span>' : '') +
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
      return { id: uid('show'), date: '', time: '', venue: '', city: '', url: '', ctaLabel: 'Tickets', note: '', soldOut: false, visible: true };
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
    }
  };

  function listAdd(path) {
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
      state.sessions = data.sessions;
      state.usingDefaultPassword = data.usingDefaultPassword;
      state.storage = data.storage || '';
      state.baseline = data.site.meta && data.site.meta.updatedAt;
      markClean();
    });
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

  /** Resolves to { dataUrl, shrunk, from, to }. Never rejects. */
  function prepareImage(file) {
    return readAsDataUrl(file).then(function (original) {
      var originalBytes = dataUrlBytes(original);
      // Vectors have no pixels to resample, and re-encoding a GIF would drop
      // its animation — leave both exactly as they are.
      if (/svg|gif/.test(file.type)) {
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

  function uploadFiles(files, onDone) {
    var queue = Array.prototype.slice.call(files).filter(function (f) {
      return /^image\//.test(f.type);
    });
    if (!queue.length) return;

    var uploaded = [];
    var saved = 0;
    var chain = queue.reduce(function (promise, file) {
      return promise.then(function () {
        return prepareImage(file).then(function (prepared) {
          if (prepared.shrunk) saved += prepared.from - prepared.to;
          return api('/admin/uploads', {
            method: 'POST',
            body: { name: file.name, dataUrl: prepared.dataUrl }
          }).then(function (data) {
            uploaded.push(data.file);
          });
        });
      });
    }, Promise.resolve());

    chain
      .then(function () {
        return loadMedia();
      })
      .then(function () {
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
    var target = event.target;
    if (target.dataset && target.dataset.path && target.dataset.rerender) render();
    if (target.dataset && target.dataset.uploadInput) {
      uploadFiles(target.files, function () {
        renderMediaViews();
      });
      target.value = '';
    }
    if (target.dataset && target.dataset.importInput) {
      var file = target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
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
    if (action === 'list-add') return listAdd(trigger.dataset.list);
    if (action === 'list-remove') {
      if (!confirm('Delete this item?')) return;
      return listRemove(trigger.dataset.list, Number(trigger.dataset.index));
    }
    if (action === 'list-move') return listMove(trigger.dataset.list, Number(trigger.dataset.index), Number(trigger.dataset.dir));

    if (action === 'pick-image') return openMediaModal(trigger.dataset.target);
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

  // drag-and-drop upload onto the drop zone
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
    if (!state.dirty) return;
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
    return Promise.all([loadSite(), loadMedia(), loadBackups()]).then(function () {
      el.login.hidden = true;
      el.app.hidden = false;
      var hash = location.hash.slice(1);
      state.section = RENDERERS[hash] ? hash : 'overview';
      render({ preserveFocus: false });
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
