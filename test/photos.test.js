'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { defaultSite } = require('../lib/defaults');
const { normalizeSite } = require('../lib/schema');
const render = require('../lib/render');

const origin = 'https://photos.example.com';
const graph = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])['@graph'];
const typeIncludes = (node, type) => [].concat(node['@type'] || []).includes(type);

function gallery() {
  return {
    kicker: 'Photos', title: 'On stage and off', intro: 'Performance photos and portraits.',
    items: [
      { id: 'stage', photo: '/uploads/stage.jpg', photoAlt: 'Taylor Drew holds a microphone on stage.', title: 'Stage portrait', caption: 'A microphone & a spotlight.', credit: 'Example Photographer', visible: true },
      { id: 'portrait', photo: 'https://cdn.example.com/portrait.jpg', photoAlt: 'Taylor Drew sits beside a blue wall.', title: 'Blue portrait', caption: 'An afternoon portrait.', credit: '', visible: true },
      { id: 'private', photo: '/uploads/HIDDEN-PHOTO.jpg', photoAlt: 'HIDDEN-ALT', title: 'HIDDEN-TITLE', caption: 'HIDDEN-CAPTION', credit: 'HIDDEN-CREDIT', visible: false }
    ]
  };
}

test('photo galleries survive partial and legacy saves, and can be explicitly emptied', () => {
  const legacy = defaultSite();
  delete legacy.photos;
  const migrated = normalizeSite({ brand: { name: 'Taylor Drew' } }, legacy);
  assert.ok(Array.isArray(migrated.photos.items));
  assert.equal(migrated.photos.items.length, 0);

  const saved = normalizeSite({ photos: gallery() }, legacy);
  assert.deepEqual(saved.photos, gallery());
  const partial = normalizeSite({ home: { subhead: 'An updated homepage introduction.' } }, saved);
  assert.deepEqual(partial.photos, saved.photos, 'an older admin payload cannot erase the gallery');
  assert.deepEqual(normalizeSite({ photos: { title: 'New gallery title' } }, saved).photos.items, saved.photos.items);
  assert.deepEqual(normalizeSite({ photos: { items: [] } }, saved).photos.items, [], 'an explicit empty list clears the gallery');
});

test('photo galleries bound item count and description lengths', () => {
  const photos = gallery();
  photos.items = Array.from({ length: 101 }, (_, index) => ({
    id: `photo-${index}`, photo: `/uploads/photo-${index}.jpg`,
    photoAlt: 'a'.repeat(600), title: 't'.repeat(200), caption: 'c'.repeat(1200), credit: 'r'.repeat(200)
  }));
  const saved = normalizeSite({ photos }, defaultSite()).photos;
  assert.equal(saved.items.length, 100);
  assert.equal(saved.items[0].photoAlt.length, 500);
  assert.equal(saved.items[0].title.length, 120);
  assert.equal(saved.items[0].caption.length, 1000);
  assert.equal(saved.items[0].credit.length, 160);
  assert.equal(saved.items[0].visible, true);
});

test('gallery normalization rejects executable image URLs and rendering escapes user text', () => {
  const unsafe = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '../../etc/passwd', '/uploads/../private.jpg', 'https://', 'https://user:password@example.com/private.jpg'];
  const saved = normalizeSite({ photos: { items: unsafe.map((photo, index) => ({ id: `unsafe-${index}`, photo })) } }, defaultSite());
  assert.deepEqual(saved.photos.items.map(item => item.photo), unsafe.map(() => ''));

  const payload = '<script>alert("gallery")</script>';
  const hostile = normalizeSite({ photos: {
    kicker: payload, title: payload, intro: payload,
    items: [{ id: 'safe-image', photo: '/uploads/safe.jpg', photoAlt: 'Portrait" onerror="alert(1)', title: payload, caption: payload, credit: payload, visible: true }]
  } }, defaultSite());
  const html = render.renderPhotos(hostile, { origin });
  assert.ok(!html.includes(payload), 'unescaped markup cannot become an executable element');
  assert.match(html, /&lt;script&gt;alert\(&quot;gallery&quot;\)&lt;\/script&gt;/);
  const imageTag = html.match(/<img\b[^>]*src="\/uploads\/safe\.jpg"[^>]*>/)?.[0];
  assert.ok(imageTag, 'the valid photo remains visible');
  assert.ok(!imageTag.includes(' onerror="'), 'quotes in alt text cannot add an event handler');
  assert.ok(imageTag.includes('&quot;'));
  assert.doesNotThrow(() => graph(html), 'escaped markup cannot break structured JSON');
});

test('gallery HTML and structured data include visible photos with explicit credits only', () => {
  const site = normalizeSite({ photos: gallery() }, defaultSite());
  const html = render.renderPhotos(site, { origin });
  assert.match(html, /rel="canonical" href="https:\/\/photos\.example\.com\/photos"/);
  assert.match(html, /src="\/uploads\/stage\.jpg"/);
  assert.match(html, /alt="Taylor Drew holds a microphone on stage\."/);
  assert.match(html, /Stage portrait/);
  assert.match(html, /A microphone &amp; a spotlight\./);
  assert.match(html, /Example Photographer/);
  assert.doesNotMatch(html, /HIDDEN-(?:PHOTO|ALT|TITLE|CAPTION|CREDIT)/);

  const nodes = graph(html);
  const page = nodes.find(node => typeIncludes(node, 'ImageGallery'));
  assert.ok(page, 'the page identifies itself as an image gallery');
  assert.ok(typeIncludes(page, 'CollectionPage'));
  const images = nodes.filter(node => typeIncludes(node, 'ImageObject'));
  const stage = images.find(node => node.url === `${origin}/uploads/stage.jpg`);
  assert.ok(stage);
  assert.equal(stage.name, 'Stage portrait');
  assert.equal(stage.description, 'Taylor Drew holds a microphone on stage.');
  assert.equal(stage.caption, 'A microphone & a spotlight.');
  assert.equal(stage.creditText, 'Example Photographer');
  assert.equal(stage.about['@id'], `${origin}/#person`);
  const portrait = images.find(node => node.url === 'https://cdn.example.com/portrait.jpg');
  assert.ok(portrait);
  assert.equal(portrait.creditText, undefined, 'a photographer credit is never fabricated');
  assert.equal(render.visiblePhotos(site).length, 2);
});

test('galleries are discoverable from old navigation and omit hidden photos from llms text', () => {
  const site = normalizeSite({ photos: gallery() }, defaultSite());
  site.nav = site.nav.filter(item => item.href !== '/photos');
  assert.match(render.renderHome(site, { origin }), /href="\/photos"/);
  const llms = render.llmsTxt(site, origin);
  assert.match(llms, /https:\/\/photos\.example\.com\/photos/);
  assert.doesNotMatch(llms, /HIDDEN-(?:PHOTO|ALT|TITLE|CAPTION|CREDIT)/);
  site.nav.push({ id: 'nav-photos', label: 'Photos', href: '/photos', visible: false });
  assert.doesNotMatch(render.renderHome(site, { origin }), /<a\b[^>]*href="\/photos"/, 'an explicitly hidden navigation item stays hidden');
});

async function startPhotoServer() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'taylosite-photos-'));
  const environment = { ...process.env, PORT: '0', TAYLOSITE_DATA_DIR: directory, ADMIN_PASSWORD: 'photo-test-password', INDEXNOW: 'off' };
  for (const name of ['VERCEL', 'TAYLOSITE_STORAGE', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_REST_API_URL', 'REDIS_REST_API_TOKEN', 'BLOB_READ_WRITE_TOKEN']) delete environment[name];
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Photo test server did not start: ${output}`)); }, 15000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = /http:\/\/localhost:(\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Photo test server exited with ${code}: ${output}`)); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  const base = `http://127.0.0.1:${port}`;
  let cookie = '', csrf = '';
  async function call(route, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + route, {
      method, redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch (_) { /* HTML and XML are checked as text. */ }
    if (json?.csrf) csrf = json.csrf;
    return { status: response.status, text, json, headers: response.headers };
  }
  return {
    base, call,
    async stop() {
      if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

test('the photos route serves saved gallery order, survives partial saves and publishes only visible sitemap images', async () => {
  const server = await startPhotoServer();
  try {
    const empty = await server.call('/photos');
    assert.equal(empty.status, 200, 'the empty gallery is a public page');
    assert.match(empty.text, /<meta name="robots" content="[^"]*noindex/);
    assert.ok(!(await server.call('/sitemap.xml')).text.includes(`<loc>${server.base}/photos</loc>`), 'an empty gallery is not advertised to crawlers');
    assert.doesNotMatch((await server.call('/')).text, /<a\b[^>]*href="\/photos"/, 'an empty gallery does not add a navigation item');
    assert.equal((await server.call('/api/login', { password: 'photo-test-password' })).status, 200);
    const saved = await server.call('/api/admin/site', { site: { photos: gallery() } }, 'PUT');
    assert.equal(saved.status, 200, saved.text);
    assert.deepEqual(saved.json.site.photos, gallery());
    assert.deepEqual((await server.call('/api/admin/site')).json.site.photos, gallery(), 'all gallery metadata survives a reload');

    const partial = await server.call('/api/admin/site', { site: { home: { subhead: 'Homepage changed by an older client.' } } }, 'PUT');
    assert.equal(partial.status, 200, partial.text);
    assert.deepEqual(partial.json.site.photos, gallery());
    const reordered = gallery();
    reordered.items.reverse();
    assert.equal((await server.call('/api/admin/site', { site: { photos: reordered } }, 'PUT')).status, 200);
    assert.deepEqual((await server.call('/api/admin/site')).json.site.photos.items.map(item => item.id), ['private', 'portrait', 'stage']);

    const page = await server.call('/photos');
    assert.equal(page.status, 200);
    const body = page.text.slice(page.text.indexOf('<body'));
    assert.ok(body.indexOf('Blue portrait') < body.indexOf('Stage portrait'), 'public gallery order follows the saved list');
    assert.doesNotMatch(page.text, /HIDDEN-(?:PHOTO|ALT|TITLE|CAPTION|CREDIT)/);
    const sitemap = (await server.call('/sitemap.xml')).text;
    const photoEntry = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].find(match => match[1].includes(`<loc>${server.base}/photos</loc>`))?.[1];
    assert.ok(photoEntry, 'the photo page is in the sitemap');
    assert.ok(photoEntry.includes(`${server.base}/uploads/stage.jpg`));
    assert.ok(photoEntry.includes('https://cdn.example.com/portrait.jpg'));
    assert.match(photoEntry, /Taylor Drew holds a microphone on stage\./);
    assert.doesNotMatch(sitemap, /HIDDEN-(?:PHOTO|ALT|TITLE|CAPTION|CREDIT)/);
    assert.doesNotMatch((await server.call('/llms.txt')).text, /HIDDEN-(?:PHOTO|ALT|TITLE|CAPTION|CREDIT)/);
    const redirect = await server.call('/photos/');
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), '/photos');
  } finally { await server.stop(); }
});

// The gallery had SEO + GEO switched off field by field, so the one page that
// exists to be found in image search was the only page the panel would not
// help write.
test('the panel offers SEO + GEO on gallery copy and keeps it off exact facts', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'admin.js'), 'utf8');
  const section = admin.slice(admin.indexOf('function sectionPhotos()'), admin.indexOf('function addGalleryPhoto('));
  assert.ok(section, 'the photos section is in the panel');

  const field = (name) => section.slice(section.indexOf(`label: '${name}'`)).split('})')[0];
  for (const generated of ['Photo title', 'Caption', 'Page title', 'Kicker', 'Introduction']) {
    assert.doesNotMatch(field(generated), /seo: false/, `${generated} offers SEO + GEO`);
  }
  // Alt text is written from the image itself, and a photographer's credit is
  // their name — neither is a field for a rewrite.
  for (const exact of ['Image description (alt text)', 'Photographer / credit']) {
    assert.match(field(exact), /seo: false/, `${exact} is not rewritten`);
  }
  assert.match(section, /seoTarget: base \+ '\.photoAlt'/, 'the photo itself can be described');

  const { fieldPolicy } = require('../public/assets/js/copy-editor');
  assert.ok(fieldPolicy('photos.items.0.title'), 'a photo title has a policy to generate against');
  assert.ok(fieldPolicy('photos.items.0.caption'), 'a photo caption has a policy to generate against');
  assert.equal(fieldPolicy('photos.items.0.photoAlt'), null);
  assert.equal(fieldPolicy('photos.items.0.credit'), null);

  // A row can be dragged or deleted while the model is writing; the guard that
  // catches that has to know about the gallery too.
  assert.match(admin, /rowPath = \/\^\(\?:about\\\.faqs\|links\\\.items\|shows\|reels\\\.items\|photos\\\.items\)/);
  assert.match(admin, /Describe every published gallery photo/);
});
