'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { startFakeRedis } = require('./helpers/fake-redis');
const { startFakeGithub } = require('./helpers/fake-github');
const { startFakeInstagram } = require('./helpers/fake-instagram');

const ROOT = path.join(__dirname, '..');
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050001a5f645b40000000049454e44ae426082',
  'hex'
);

/** Boot the real server as a child process and wait for it to answer. */
async function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taylosite-srv-'));
  // A null value removes an inherited variable — this machine may well have a
  // GITHUB_TOKEN of its own, which some cases need absent.
  const childEnv = { ...process.env, PORT: '0', TAYLOSITE_DATA_DIR: dir, ...env };
  for (const [key, value] of Object.entries(childEnv)) {
    if (value === null) delete childEnv[key];
  }
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 15000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = /http:\/\/localhost:(\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}:\n${output}`));
    });
  });

  const base = `http://127.0.0.1:${port}`;
  const jar = { cookie: '', csrf: null };

  async function call(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (jar.cookie) headers.cookie = jar.cookie;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.csrf !== false && jar.csrf) headers['x-csrf-token'] = jar.csrf;

    const res = await fetch(base + pathname, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'manual'
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) jar.cookie = setCookie.split(';')[0];
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      /* not every response is JSON */
    }
    return { status: res.status, headers: res.headers, text, json };
  }

  return {
    base,
    call,
    async login(password = 'weed') {
      const res = await call('/api/login', { method: 'POST', body: { password } });
      if (res.json && res.json.csrf) jar.csrf = res.json.csrf;
      return res;
    },
    forgetCsrf() {
      jar.csrf = null;
    },
    async stop() {
      child.kill('SIGKILL');
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function withServer(env, run) {
  const server = await startServer(env);
  try {
    await run(server);
  } finally {
    await server.stop();
  }
}

test('public pages render', async () => {
  await withServer({}, async (server) => {
    for (const page of ['/', '/about', '/links']) {
      const res = await server.call(page);
      assert.strictEqual(res.status, 200, `${page} responds`);
      assert.match(res.text, /TAYLOR DREW|Taylor Drew/i);
    }
    assert.strictEqual((await server.call('/admin')).status, 200);
    assert.strictEqual((await server.call('/robots.txt')).status, 200);
    assert.match((await server.call('/sitemap.xml')).text, /<urlset/);
    assert.strictEqual((await server.call('/nope')).status, 404);
  });
});

test('pages carry the meta a phone needs', async () => {
  await withServer({}, async (server) => {
    for (const page of ['/', '/about', '/links']) {
      const { text } = await server.call(page);
      assert.match(
        text,
        /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/,
        `${page} opts into the display cutout area so safe-area insets resolve`
      );
      // The browser tints its chrome with this. The accent would draw a
      // coloured band above the header instead of continuing it.
      assert.match(text, /<meta name="theme-color" content="#0b0b0b">/, `${page} matches the page background`);
    }
  });
});

test('content is escaped on the way out', async () => {
  await withServer({}, async (server) => {
    await server.login();
    const payload = '<script>alert(1)</script>';
    await server.call('/api/admin/site', { method: 'PUT', body: { site: { home: { subhead: payload } } } });

    const res = await server.call('/');
    assert.ok(!res.text.includes(payload), 'the raw tag never reaches the page');
    assert.match(res.text, /&lt;script&gt;/);
  });
});

test('structured data is valid JSON and covers upcoming shows', async () => {
  await withServer({}, async (server) => {
    await server.login();
    await server.call('/api/admin/site', {
      method: 'PUT',
      body: { site: { shows: [{ id: 's1', date: '2099-05-01', venue: 'The Venue', city: 'New York, NY', visible: true }] } }
    });

    const html = (await server.call('/')).text;
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
      JSON.parse(m[1])
    );
    assert.strictEqual(blocks.length, 1, 'one linked graph rather than loose objects');

    const graph = blocks[0]['@graph'];
    const byType = (type) => graph.filter((node) => node['@type'] === type);

    assert.ok(byType('WebSite').length, 'the site itself');
    assert.ok(byType('WebPage').length, 'the home page is a plain page — the profile lives on /about');

    const person = byType('Person')[0];
    assert.ok(person, 'the person');
    assert.match(person['@id'], /#person$/);

    const event = byType('Event').find((e) => e.startDate === '2099-05-01');
    assert.ok(event, 'the upcoming show');
    assert.strictEqual(event.location.address['@type'], 'PostalAddress');
    assert.strictEqual(event.location.address.addressLocality, 'New York');
    assert.strictEqual(event.location.address.addressRegion, 'NY');
    assert.deepStrictEqual(event.performer, { '@id': person['@id'] }, 'shows point back at the same person');

    // Sub-pages describe where they sit.
    const aboutGraph = JSON.parse(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec((await server.call('/about')).text)[1]
    )['@graph'];
    assert.ok(aboutGraph.some((n) => n['@type'] === 'ProfilePage'), 'the about page is the profile');
    assert.ok(aboutGraph.some((n) => n['@type'] === 'BreadcrumbList'));
  });
});

test('the machine-readable surface answers for the site', async (t) => {
  await withServer({}, async (server) => {
    await server.login();
    await server.call('/api/admin/site', {
      method: 'PUT',
      body: {
        site: {
          links: {
            items: [
              { id: 'l1', label: 'Instagram', url: 'https://instagram.com/taylordrew4u', visible: true },
              { id: 'l2', label: 'Hidden', url: 'https://hidden.example', visible: false }
            ]
          },
          home: { photo: '/uploads/hero.png', photoAlt: 'Taylor Drew on stage' },
          about: {
            photo: '/uploads/portrait.png',
            body: ['A New York City stand-up comedian.'],
            facts: [{ id: 'f1', label: 'Booking', value: 'hi@example.com' }]
          }
        }
      }
    });

    await t.test('/llms.txt names the site, its pages and its links', async () => {
      const res = await server.call('/llms.txt');
      assert.strictEqual(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/plain/);
      assert.match(res.text, /^# Taylor Drew/m);
      assert.match(res.text, /A New York City stand-up comedian\./, 'the bio, not a second version of it');
      assert.match(res.text, /\[Instagram\]\(https:\/\/instagram\.com\/taylordrew4u\)/);
      assert.ok(!res.text.includes('hidden.example'), 'a hidden link stays hidden here too');
    });

    await t.test('and never leaks what the pages do not show', async () => {
      const res = await server.call('/llms.txt');
      assert.ok(!/hash|salt|password|csrf/i.test(res.text), 'no credentials in the file crawlers read first');
    });

    await t.test('robots.txt names answer engines and training crawlers apart', async () => {
      const { text } = await server.call('/robots.txt');
      for (const agent of ['OAI-SearchBot', 'PerplexityBot', 'ClaudeBot', 'GPTBot', 'Google-Extended']) {
        assert.ok(text.includes(`User-agent: ${agent}`), `${agent} is addressed`);
      }
      assert.match(text, /Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
      assert.ok(text.includes('Disallow: /admin'), 'the panel stays out of every group');
      assert.ok(text.includes('Disallow: /api/'), 'and so does the JSON it talks to');
      assert.match(text, /# llms\.txt: https?:\/\/[^\s]+\/llms\.txt/, 'the summary is pointed at where they all look');
    });

    await t.test('the sitemap carries each page’s photo', async () => {
      const { text } = await server.call('/sitemap.xml');
      assert.match(text, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
      assert.match(text, /<image:loc>[^<]+<\/image:loc>/);
    });

    await t.test('a missing page asks not to be indexed', async () => {
      const res = await server.call('/nope');
      assert.strictEqual(res.status, 404);
      assert.match(res.text, /<meta name="robots" content="noindex, follow">/);
      assert.ok(!/index, follow,/.test(res.text), 'and not both at once');
    });

    await t.test('the links page publishes the list itself', async () => {
      const graph = JSON.parse(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec((await server.call('/links')).text)[1]
      )['@graph'];
      const list = graph.find((n) => n['@type'] === 'ItemList');
      assert.ok(list, 'an ItemList');
      assert.strictEqual(list.numberOfItems, 1, 'only the visible link');
      assert.strictEqual(list.itemListElement[0].url, 'https://instagram.com/taylordrew4u', 'the real URL, not /go/');
      assert.deepStrictEqual(
        graph.find((n) => n['@type'] === 'CollectionPage').mainEntity,
        { '@id': list['@id'] },
        'and the page points at it'
      );
    });

    await t.test('the about page is the ProfilePage, not the home page', async () => {
      const typeOf = async (path) => {
        const graph = JSON.parse(
          /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec((await server.call(path)).text)[1]
        )['@graph'];
        return graph.find((n) => String(n['@id'] || '').endsWith('#webpage'))['@type'];
      };

      // Google documents ProfilePage as valid for an "About Me" page and
      // invalid for a mixed-content home page, so it belongs on /about.
      assert.strictEqual(await typeOf('/about'), 'ProfilePage');
      assert.strictEqual(await typeOf('/'), 'WebPage');

      const graph = JSON.parse(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec((await server.call('/about')).text)[1]
      )['@graph'];
      const person = graph.find((n) => n['@type'] === 'Person');
      const page = graph.find((n) => n['@type'] === 'ProfilePage');
      assert.deepStrictEqual(page.mainEntity, { '@id': person['@id'] }, 'with the person as its mainEntity');
      assert.match(person.mainEntityOfPage['@id'], /\/about#webpage$/, 'and she points back at it');
    });

    await t.test('a venue address becomes an address an event listing can use', async () => {
      await server.call('/api/admin/site', {
        method: 'PUT',
        body: {
          site: {
            shows: [
              {
                id: 'sa',
                date: '2099-07-07',
                venue: 'Comedy Cellar',
                city: 'New York, NY',
                street: '117 MacDougal St',
                postalCode: '10012',
                country: 'US',
                visible: true
              },
              { id: 'sb', date: '2099-08-08', venue: 'Somewhere', city: 'Chicago, IL', visible: true }
            ]
          }
        }
      });

      const graph = JSON.parse(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec((await server.call('/')).text)[1]
      )['@graph'];
      const events = graph.filter((n) => n['@type'] === 'Event');

      assert.deepStrictEqual(events.find((e) => /Cellar/.test(e.name)).location.address, {
        '@type': 'PostalAddress',
        streetAddress: '117 MacDougal St',
        postalCode: '10012',
        addressCountry: 'US',
        addressLocality: 'New York',
        addressRegion: 'NY'
      });
      assert.deepStrictEqual(
        events.find((e) => /Somewhere/.test(e.name)).location.address,
        { '@type': 'PostalAddress', addressLocality: 'Chicago', addressRegion: 'IL' },
        'a gig with only a city still validates'
      );
    });

    await t.test('the questions she answers are published as questions', async () => {
      await server.call('/api/admin/site', {
        method: 'PUT',
        body: {
          site: {
            about: {
              faqLabel: 'Common questions',
              faqs: [
                { id: 'q-who', question: 'Who is Taylor Drew?', answer: 'A stand-up comedian in New York City.', visible: true },
                { id: 'q-hid', question: 'Draft question', answer: 'Not ready.', visible: false }
              ]
            }
          }
        }
      });

      const html = (await server.call('/about')).text;
      assert.match(html, /Who is Taylor Drew\?/, 'a visitor reads it on the page');
      assert.ok(!html.includes('Draft question'), 'and a hidden one stays off it');

      const graph = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1])['@graph'];
      const faq = graph.find((n) => n['@type'] === 'FAQPage');
      assert.ok(faq, 'and a machine reads it as an FAQPage');
      assert.strictEqual(faq.mainEntity.length, 1, 'only the visible one');
      assert.strictEqual(faq.mainEntity[0].acceptedAnswer.text, 'A stand-up comedian in New York City.');
      assert.deepStrictEqual(
        graph.find((n) => n['@type'] === 'ProfilePage').hasPart,
        { '@id': faq['@id'] },
        'hung off the page it is on'
      );

      const llms = (await server.call('/llms.txt')).text;
      assert.match(llms, /## Common questions/);
      assert.match(llms, /### Who is Taylor Drew\?/);
      assert.ok(!llms.includes('Draft question'), 'hidden here too');

      const home = (await server.call('/')).text;
      assert.ok(!home.includes('FAQPage'), 'the questions belong to the page that carries them');
    });

    await t.test('a press quote is attributed rather than left as decoration', async () => {
      await server.call('/api/admin/site', {
        method: 'PUT',
        body: { site: { about: { quotes: [{ id: 'q1', text: 'Relentlessly funny.', source: 'Time Out' }] } } }
      });

      const graph = JSON.parse(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec((await server.call('/about')).text)[1]
      )['@graph'];
      const quote = graph.find((n) => n['@type'] === 'Quotation');
      const person = graph.find((n) => n['@type'] === 'Person');

      assert.strictEqual(quote.text, 'Relentlessly funny.');
      assert.strictEqual(quote.citation, 'Time Out');
      assert.deepStrictEqual(quote.about, { '@id': person['@id'] });
      assert.deepStrictEqual(person.subjectOf, [{ '@id': quote['@id'] }], 'and she is the subject of it');
    });

    await t.test('a show with a door time starts in the evening, not at midnight', async () => {
      await server.call('/api/admin/site', {
        method: 'PUT',
        body: {
          site: {
            shows: [
              { id: 's1', date: '2099-05-04', time: '8:00 PM', venue: 'Comedy Cellar', city: 'New York, NY', note: 'Late show', visible: true },
              { id: 's2', date: '2099-06-01', time: 'doors vary', venue: 'The Bell House', visible: true }
            ]
          }
        }
      });

      const graph = JSON.parse(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec((await server.call('/')).text)[1]
      )['@graph'];
      const events = graph.filter((n) => n['@type'] === 'Event');
      const cellar = events.find((e) => /Comedy Cellar/.test(e.name));

      assert.strictEqual(cellar.startDate, '2099-05-04T20:00');
      assert.strictEqual(cellar.description, 'Late show', 'the note says what kind of night it is');
      assert.strictEqual(
        events.find((e) => /Bell House/.test(e.name)).startDate,
        '2099-06-01',
        'an unreadable time is left off rather than guessed at'
      );
    });

    await t.test('search-engine verification is rendered, and only as a token', async () => {
      await server.call('/api/admin/site', {
        method: 'PUT',
        body: {
          site: {
            seo: {
              googleVerification: '<meta name="google-site-verification" content="abc-123_x" />',
              bingVerification: '"><script>alert(1)</script>'
            }
          }
        }
      });

      const html = (await server.call('/')).text;
      assert.match(html, /<meta name="google-site-verification" content="abc-123_x">/, 'the tag is unwrapped to its token');
      assert.ok(!/msvalidate/.test(html), 'and anything that is not a token is refused outright');
    });

    await t.test('awards and credits are published as data, not only as prose', async () => {
      await server.call('/api/admin/site', {
        method: 'PUT',
        body: {
          site: {
            about: {
              credits: [
                { id: 'c1', title: 'Best Writer', detail: 'Alternative Film Festival', year: '2025', award: true, visible: true },
                { id: 'c2', title: 'A Screen Credit', detail: 'Series', year: '2024', url: 'https://imdb.example/title', award: false, visible: true },
                { id: 'c3', title: 'Kept Back', award: false, visible: false }
              ]
            }
          }
        }
      });

      const graph = JSON.parse(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec((await server.call('/')).text)[1]
      )['@graph'];
      const person = graph.find((n) => n['@type'] === 'Person');
      const works = graph.filter((n) => n['@type'] === 'CreativeWork');

      assert.deepStrictEqual(person.award, ['Best Writer — Alternative Film Festival'], 'awards are a Person property');
      assert.strictEqual(works.length, 1, 'the non-award credit becomes the work it is, and the hidden one does not');
      assert.strictEqual(works[0].name, 'A Screen Credit');
      assert.strictEqual(works[0].datePublished, '2024');
      assert.deepStrictEqual(works[0].contributor, { '@id': person['@id'] }, 'and points back at her');

      const about = (await server.call('/about')).text;
      assert.match(about, /A Screen Credit/, 'a visitor sees the same list a crawler does');
      assert.ok(!about.includes('Kept Back'), 'except what she chose to hide');
    });

    await t.test('an IMDb profile counts as the same person elsewhere', async () => {
      await server.call('/api/admin/site', {
        method: 'PUT',
        body: { site: { links: { items: [{ id: 'l3', label: 'IMDb', url: 'https://www.imdb.com/name/nm123/', visible: true }] } } }
      });
      const graph = JSON.parse(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec((await server.call('/')).text)[1]
      )['@graph'];
      assert.ok(
        graph.find((n) => n['@type'] === 'Person').sameAs.includes('https://www.imdb.com/name/nm123/'),
        'sameAs is what tells a knowledge graph the two profiles are one person'
      );
    });

    await t.test('the tab icon is drawn, and an uploaded one takes the large sizes', async () => {
      const svg = await server.call('/favicon.svg');
      assert.strictEqual(svg.status, 200);
      assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
      assert.match(svg.text, />TD</, 'initials, which is all that survives at 16 pixels');

      const dark = (await server.call('/favicon-dark.svg')).text;
      assert.notStrictEqual(dark, svg.text, 'a black square would vanish into a dark tab strip');

      assert.strictEqual((await server.call('/favicon.ico')).status, 200, 'asked for by name whatever the page declares');

      const manifest = await server.call('/site.webmanifest');
      assert.match(manifest.headers.get('content-type'), /manifest\+json/);
      assert.strictEqual(JSON.parse(manifest.text).name, 'Taylor Drew');

      await server.call('/api/admin/site', { method: 'PUT', body: { site: { seo: { favicon: '/uploads/logo.png' } } } });
      const html = (await server.call('/')).text;
      assert.match(html, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"/);
      assert.match(html, /<link rel="apple-touch-icon" href="\/uploads\/logo\.png">/, 'the upload keeps the big surfaces');
    });

    await t.test('every photo is a described entity, not a filename', async () => {
      await server.call('/api/admin/site', {
        method: 'PUT',
        body: {
          site: {
            home: { photo: '/uploads/hero.png', photoAlt: 'Taylor Drew against a pale backdrop' },
            about: { photo: '/uploads/portrait.png', photoAlt: 'Taylor Drew with her arms crossed' },
            seo: { ogImage: '/uploads/logo.png', ogImageAlt: 'Taylor Drew logo' }
          }
        }
      });

      const graph = JSON.parse(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec((await server.call('/about')).text)[1]
      )['@graph'];
      const captions = graph.filter((n) => n['@type'] === 'ImageObject').map((n) => n.caption).sort();
      assert.deepStrictEqual(captions, [
        'Taylor Drew against a pale backdrop',
        'Taylor Drew logo',
        'Taylor Drew with her arms crossed'
      ]);
      assert.strictEqual(
        graph.find((n) => n['@type'] === 'ProfilePage').primaryImageOfPage['@id'],
        graph.find((n) => n.caption === 'Taylor Drew with her arms crossed')['@id'],
        'each page leads with its own photo'
      );

      const home = (await server.call('/')).text;
      assert.match(home, /<meta property="og:image:alt" content="Taylor Drew logo">/, 'the share image, not the hero');

      const sitemap = (await server.call('/sitemap.xml')).text;
      assert.match(sitemap, /<image:caption>Taylor Drew against a pale backdrop<\/image:caption>/);
      assert.match(sitemap, /<image:caption>Taylor Drew with her arms crossed<\/image:caption>/);
    });

    await t.test('the person carries an occupation, a bio and one shared image node', async () => {
      const graph = JSON.parse(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec((await server.call('/')).text)[1]
      )['@graph'];
      const person = graph.find((n) => n['@type'] === 'Person');
      const image = graph.find((n) => n['@type'] === 'ImageObject');
      const page = graph.find((n) => n['@type'] === 'WebPage');

      assert.strictEqual(person.hasOccupation['@type'], 'Occupation');
      assert.match(person.description, /A New York City stand-up comedian/, 'the bio outranks the meta description');
      assert.ok(image, 'the photo is a node');
      const referenced = [].concat(person.image).map((r) => r['@id']);
      assert.ok(referenced.includes(image['@id']), 'referenced, not repeated');
      assert.ok(referenced.every((id) => graph.some((n) => n['@id'] === id)), 'and every reference resolves');
      assert.ok(page.primaryImageOfPage['@id'], 'the page leads with one of them');
      assert.strictEqual(page.speakable['@type'], 'SpeakableSpecification');
    });
  });
});

test('the reel wall plays what it can and links the rest', async () => {
  await withServer({}, async (server) => {
    await server.login();
    await server.call('/api/admin/site', {
      method: 'PUT',
      body: {
        site: {
          reels: {
            title: 'Watch',
            items: [
              { id: 'r-vid', url: 'https://www.instagram.com/reel/AAA/', video: '/uploads/a.mp4', caption: 'Crowd work', visible: true },
              { id: 'r-pos', url: 'https://www.instagram.com/reel/BBB/', poster: '/uploads/b.jpg', caption: 'Roast', visible: true },
              { id: 'r-emb', url: 'https://www.instagram.com/reel/CCC', caption: 'Embed only', visible: true },
              { id: 'r-off', url: 'https://www.instagram.com/reel/DDD/', video: '/uploads/d.mp4', caption: 'Hidden', visible: false }
            ]
          }
        }
      }
    });

    const res = await server.call('/reels');
    assert.strictEqual(res.status, 200);
    const html = res.text;

    // A video of its own is the only thing that can actually loop.
    assert.match(html, /<video class="reel-media" src="\/uploads\/a\.mp4"[^>]*\bmuted\b[^>]*\bloop\b[^>]*\bplaysinline\b/);
    assert.match(html, /<img class="reel-media" src="\/uploads\/b\.jpg" alt="Roast"/, 'a poster falls back to the still');
    assert.match(
      html,
      /<iframe class="reel-media reel-embed" src="https:\/\/www\.instagram\.com\/reel\/CCC\/embed"/,
      'and a bare permalink falls back to Instagram’s embed, with exactly one slash'
    );
    assert.ok(!html.includes('Hidden'), 'a hidden reel stays off the wall');

    // The embed is interactive, so it is not wrapped in a link that would eat it.
    assert.match(html, /<a class="reel" href="https:\/\/www\.instagram\.com\/reel\/AAA\/"/);
    assert.ok(!/<a class="reel" href="https:\/\/www\.instagram\.com\/reel\/CCC/.test(html));

    const sitemap = (await server.call('/sitemap.xml')).text;
    assert.match(sitemap, /<loc>https?:\/\/[^<]+\/reels<\/loc>/, 'the page is in the sitemap');

    const llms = (await server.call('/llms.txt')).text;
    assert.match(llms, /\/reels\)/, 'and named in the summary answer engines read');
  });
});

test('the wall fills itself from the connected account', async () => {
  const api = await startFakeInstagram({
    media: [
      {
        id: '111',
        caption: 'Crowd work #comedy',
        media_type: 'VIDEO',
        media_product_type: 'REELS',
        media_url: 'https://cdn.example/111.mp4',
        permalink: 'https://www.instagram.com/reel/AAA/',
        thumbnail_url: 'https://cdn.example/111.jpg'
      },
      {
        id: '222',
        caption: 'A photo',
        media_type: 'IMAGE',
        media_product_type: 'FEED',
        permalink: 'https://www.instagram.com/p/BBB/'
      }
    ]
  });

  try {
    await withServer({ INSTAGRAM_TOKEN: 'tok', INSTAGRAM_API_BASE: api.base }, async (server) => {
      await server.login();
      // One reel pinned by hand, and it is also in the feed — it must not double.
      await server.call('/api/admin/site', {
        method: 'PUT',
        body: {
          site: {
            reels: {
              items: [
                { id: 'pinned', url: 'https://www.instagram.com/reel/AAA', video: '/uploads/mine.mp4', caption: 'Pinned', visible: true }
              ]
            }
          }
        }
      });

      const html = (await server.call('/reels')).text;

      assert.match(html, /\/uploads\/mine\.mp4/, 'the pinned one leads');
      assert.strictEqual(
        (html.match(/instagram\.com\/reel\/AAA/g) || []).length,
        1,
        'and the same reel from the feed does not appear twice'
      );
      assert.ok(!html.includes('cdn.example/111.mp4'), 'the pinned version wins over the fetched one');
      assert.ok(!html.includes('A photo'), 'a photo is not a reel');

      const health = (await server.call('/healthz')).json;
      assert.strictEqual(health.credentials.instagram, true, 'healthz says the account is connected');
    });
  } finally {
    await api.stop();
  }
});

test('a reel only on Instagram is played from Instagram', async () => {
  const api = await startFakeInstagram({
    media: [
      {
        id: '999',
        caption: 'Roast battle',
        media_type: 'VIDEO',
        media_product_type: 'REELS',
        media_url: 'https://cdn.example/999.mp4',
        permalink: 'https://www.instagram.com/reel/ZZZ/',
        thumbnail_url: 'https://cdn.example/999.jpg'
      }
    ]
  });

  try {
    await withServer({ INSTAGRAM_TOKEN: 'tok', INSTAGRAM_API_BASE: api.base }, async (server) => {
      const html = (await server.call('/reels')).text;
      // The MP4 from their API is what makes a silent loop possible at all.
      assert.match(html, /<video class="reel-media" src="https:\/\/cdn\.example\/999\.mp4" poster="https:\/\/cdn\.example\/999\.jpg"[^>]*\bloop\b/);
      assert.match(html, /aria-label="Roast battle"/);
      assert.ok(!html.includes('reel-embed'), 'no embed fallback is needed when the video is in hand');
    });
  } finally {
    await api.stop();
  }
});

test('an Instagram outage leaves the rest of the page standing', async () => {
  const api = await startFakeInstagram({ media: [], state: { down: true } });
  try {
    await withServer({ INSTAGRAM_TOKEN: 'tok', INSTAGRAM_API_BASE: api.base }, async (server) => {
      const res = await server.call('/reels');
      assert.strictEqual(res.status, 200, 'the page still answers');
      assert.match(res.text, /Reels are unavailable just now/);
      assert.match(res.text, /<header class="topbar">/, 'and the site around it is intact');
    });
  } finally {
    await api.stop();
  }
});

test('a stored Instagram token never reaches a visitor', async () => {
  const api = await startFakeInstagram({ media: [] });
  try {
    await withServer(
      { INSTAGRAM_APP_ID: '99', INSTAGRAM_APP_SECRET: 'sh', INSTAGRAM_API_BASE: api.base, INSTAGRAM_OAUTH_BASE: api.base },
      async (server) => {
        await server.login();

        const connected = await server.call('/api/admin/instagram', { method: 'POST', body: { code: 'abc' } });
        assert.strictEqual(connected.status, 200);

        // The token now lives in site.auth, which is the branch publicSite strips.
        const content = await server.call('/api/content');
        assert.strictEqual(content.status, 200);
        assert.ok(!JSON.stringify(content.json).includes('long-token'), 'not in the public site document');
        assert.strictEqual(content.json.auth, undefined, 'because auth never leaves the server at all');

        const status = (await server.call('/api/admin/instagram')).json;
        assert.strictEqual(status.connected, true);
        assert.ok(!JSON.stringify(status).includes('long-token'), 'and not even the panel is told the token');
        assert.match(status.redirectUri, /\/admin$/);

        for (const path of ['/', '/about', '/links', '/reels', '/llms.txt']) {
          assert.ok(!(await server.call(path)).text.includes('long-token'), `not on ${path}`);
        }

        const gone = await server.call('/api/admin/instagram', { method: 'DELETE' });
        assert.strictEqual(gone.status, 200);
        assert.strictEqual((await server.call('/api/admin/instagram')).json.connected, false);
      }
    );
  } finally {
    await api.stop();
  }
});

test('connecting Instagram needs a session and a CSRF token', async () => {
  await withServer({ INSTAGRAM_APP_ID: '99', INSTAGRAM_APP_SECRET: 'sh' }, async (server) => {
    // Signed out entirely.
    assert.strictEqual(
      (await server.call('/api/admin/instagram', { method: 'POST', body: { code: 'abc' } })).status,
      401
    );

    // Signed in, but without the per-session CSRF token a form post would carry.
    await server.login();
    server.forgetCsrf();
    const res = await server.call('/api/admin/instagram', { method: 'POST', body: { code: 'abc' }, csrf: false });
    assert.strictEqual(res.status, 403, 'a cookie alone must not be enough to bind an account');
  });
});

test('a pasted feed URL fills the wall with no Meta app at all', async () => {
  const http = require('node:http');
  const feed = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify([
        {
          id: 'r1',
          mediaType: 'VIDEO',
          mediaUrl: 'https://cdn.example/one.mp4',
          thumbnailUrl: 'https://cdn.example/one.jpg',
          permalink: 'https://www.instagram.com/reel/ONE/',
          caption: 'Roast battle #skankfest'
        }
      ])
    );
  });
  await new Promise((r) => feed.listen(0, '127.0.0.1', r));
  const feedUrl = `http://127.0.0.1:${feed.address().port}/feed.json`;

  try {
    // No INSTAGRAM_* variables anywhere — the point of this path.
    await withServer({ INSTAGRAM_TOKEN: null, IG_TOKEN: null, INSTAGRAM_APP_ID: null, INSTAGRAM_APP_SECRET: null }, async (server) => {
      await server.login();
      await server.call('/api/admin/site', { method: 'PUT', body: { site: { reels: { feedUrl } } } });

      const html = (await server.call('/reels')).text;
      assert.match(html, /<video class="reel-media" src="https:\/\/cdn\.example\/one\.mp4"[^>]*\bloop\b/, 'it loops');
      assert.match(html, /aria-label="Roast battle"/, 'caption kept, hashtag dropped');
      assert.match(html, /href="https:\/\/www\.instagram\.com\/reel\/ONE\/"/, 'and links back to the post');
    });
  } finally {
    await new Promise((r) => feed.close(r));
  }
});

test('a profile URL falls back to Instagram\u2019s own widget rather than an apology', async () => {
  await withServer({ INSTAGRAM_TOKEN: null, IG_TOKEN: null }, async (server) => {
    await server.login();
    await server.call('/api/admin/site', {
      method: 'PUT',
      body: { site: { reels: { feedUrl: 'https://www.instagram.com/taylordrew4u/reels/', items: [] } } }
    });

    const html = (await server.call('/reels')).text;
    assert.match(
      html,
      /<iframe[^>]+src="https:\/\/www\.instagram\.com\/taylordrew4u\/embed\/"/,
      'their player does the work, so nothing has to be connected'
    );
    assert.match(html, /href="https:\/\/www\.instagram\.com\/taylordrew4u\/reels\/"/, 'with a way through to the rest');
  });
});

test('a profile link is claimed by its canonical URL, and the handle counts as a name', async () => {
  await withServer({}, async (server) => {
    await server.login();
    await server.call('/api/admin/site', {
      method: 'PUT',
      body: {
        site: {
          links: {
            items: [
              { id: 'ig', label: 'Instagram', url: 'https://instagram.com/taylordrew4u' },
              { id: 'imdb', label: 'IMDB', url: 'https://www.imdb.com/name/nm6287452/?ref_=tt_ov_1_1' }
            ]
          }
        }
      }
    });

    const html = (await server.call('/about')).text;
    const graph = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1])['@graph'];
    const person = graph.find((n) => n['@type'] === 'Person');

    assert.ok(
      person.sameAs.includes('https://www.imdb.com/name/nm6287452/'),
      'the profile, not the click that arrived at it'
    );
    assert.ok(!person.sameAs.some((u) => u.includes('ref_=')), 'no tracking left in the claim');
    assert.ok([].concat(person.alternateName).includes('@taylordrew4u'), 'searched by handle as much as by name');
    assert.match(person.disambiguatingDescription, /New York City/, 'and which Taylor Drew this is');

    await server.call('/api/admin/site', { method: 'PUT', body: { site: { brand: { gender: 'Female' } } } });
    const withGender = (await server.call('/about')).text;
    const graph2 = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(withGender)[1])['@graph'];
    assert.strictEqual(
      graph2.find((n) => n['@type'] === 'Person').gender,
      'Female',
      'stated, so it can be matched rather than inferred from pronouns'
    );
  });
});

test('a menu saved before a page existed still links to it', async () => {
  await withServer({}, async (server) => {
    await server.login();
    // A nav from before /reels existed — exactly what a live site would hold.
    await server.call('/api/admin/site', {
      method: 'PUT',
      body: {
        site: {
          nav: [
            { id: 'n1', label: 'Home', href: '/', visible: true },
            { id: 'n2', label: 'About', href: '/about', visible: true },
            { id: 'n3', label: 'Links', href: '/links', visible: true }
          ]
        }
      }
    });

    const labels = (html) => [...html.matchAll(/<a class="nav-link[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
    assert.deepStrictEqual(labels((await server.call('/')).text), ['Home', 'About', 'Links', 'Reels']);

    // On the page itself the link is marked current, like any other.
    assert.match((await server.call('/reels')).text, /<a class="nav-link is-active" href="\/reels" aria-current="page">Reels<\/a>/);

    // And it can still be turned off — by keeping a hidden entry, not by absence.
    await server.call('/api/admin/site', {
      method: 'PUT',
      body: {
        site: {
          nav: [
            { id: 'n1', label: 'Home', href: '/', visible: true },
            { id: 'n4', label: 'Reels', href: '/reels', visible: false }
          ]
        }
      }
    });
    assert.deepStrictEqual(labels((await server.call('/')).text), ['Home'], 'a hidden entry suppresses it');
  });
});

test('an unsupported upload is refused by type, and a large one by size', async () => {
  await withServer({}, async (server) => {
    await server.login();
    const bad = await server.call('/api/admin/uploads', {
      method: 'POST',
      body: { name: 'x', dataUrl: 'data:application/zip;base64,UEsDBA==' }
    });
    assert.strictEqual(bad.status, 415);

    // Video is an accepted type — whether it fits is the backend's call.
    const video = await server.call('/api/admin/uploads', {
      method: 'POST',
      body: { name: 'clip', dataUrl: 'data:video/mp4;base64,AAAAIGZ0eXBpc29t' }
    });
    assert.strictEqual(video.status, 201);
    assert.match(video.json.file.url, /\.mp4$/);
  });
});

test('a trailing slash redirects instead of answering as a second URL', async () => {
  await withServer({}, async (server) => {
    const res = await server.call('/about/');
    assert.strictEqual(res.status, 301);
    assert.strictEqual(res.headers.get('location'), '/about');

    const withQuery = await server.call('/links/?ref=poster');
    assert.strictEqual(withQuery.status, 301);
    assert.strictEqual(withQuery.headers.get('location'), '/links?ref=poster', 'the query survives');
  });
});

test('crawler directives and identity links are present', async () => {
  await withServer({}, async (server) => {
    await server.login();
    await server.call('/api/admin/site', {
      method: 'PUT',
      body: {
        site: {
          links: {
            items: [
              { id: 'l1', label: 'X', url: 'https://x.com/taylordrew', visible: true },
              { id: 'l2', label: 'Instagram', url: 'https://instagram.com/taylordrew', visible: true },
              { id: 'l3', label: 'Booking', url: 'mailto:hi@example.com', visible: true }
            ]
          }
        }
      }
    });

    const html = (await server.call('/')).text;
    assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large/);
    assert.match(html, /<link rel="alternate" type="text\/markdown" href="\/llms\.txt"/, 'the summary is discoverable from the page');
    assert.match(html, /<meta property="og:type" content="profile">/);
    assert.match(html, /<meta name="twitter:creator" content="@taylordrew">/);
    assert.match(html, /<link rel="me" href="https:\/\/x\.com\/taylordrew">/);
    assert.match(html, /<link rel="me" href="https:\/\/instagram\.com\/taylordrew">/);
    assert.ok(!/rel="me" href="mailto/.test(html), 'only profiles, not the booking address');

    const graph = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1])['@graph'];
    const person = graph.find((n) => n['@type'] === 'Person');
    assert.deepStrictEqual(person.sameAs, ['https://x.com/taylordrew', 'https://instagram.com/taylordrew']);
  });
});

test('the admin API refuses unauthenticated and CSRF-less writes', async () => {
  await withServer({}, async (server) => {
    assert.strictEqual((await server.call('/api/admin/site')).status, 401);

    await server.login();
    assert.strictEqual((await server.call('/api/admin/site')).status, 200);

    server.forgetCsrf();
    const res = await server.call('/api/admin/site', { method: 'PUT', body: { site: {} }, csrf: false });
    assert.strictEqual(res.status, 403, 'a cookie alone is not enough to write');
  });
});

test('the wrong password is rejected and the right one signs in', async () => {
  await withServer({}, async (server) => {
    assert.strictEqual((await server.login('not-the-password')).status, 401);
    assert.strictEqual((await server.login('weed')).status, 200);
    assert.strictEqual((await server.call('/api/session')).json.signedIn, true);

    await server.call('/api/logout', { method: 'POST' });
    assert.strictEqual((await server.call('/api/session')).json.signedIn, false);
  });
});

test('ADMIN_PASSWORD seeds the password when set', async () => {
  await withServer({ ADMIN_PASSWORD: 'correct-horse' }, async (server) => {
    assert.strictEqual((await server.login('weed')).status, 401);
    assert.strictEqual((await server.login('correct-horse')).status, 200);
  });
});

test('repeated wrong guesses lock the caller out', async () => {
  await withServer({}, async (server) => {
    let locked = null;
    for (let i = 0; i < 12 && !locked; i++) {
      const res = await server.login('wrong');
      if (res.status === 429) locked = res;
    }
    assert.ok(locked, 'a lockout eventually kicks in');
    assert.match(locked.json.error, /Too many attempts/);
  });
});

test('uploads are validated, stored and served', async () => {
  await withServer({}, async (server) => {
    await server.login();

    const bad = await server.call('/api/admin/uploads', {
      method: 'POST',
      body: { name: 'x.exe', dataUrl: 'data:application/x-msdownload;base64,AAAA' }
    });
    assert.strictEqual(bad.status, 415, 'only images are accepted');

    const notADataUrl = await server.call('/api/admin/uploads', {
      method: 'POST',
      body: { name: 'x.png', dataUrl: 'https://example.com/x.png' }
    });
    assert.strictEqual(notADataUrl.status, 400);

    const good = await server.call('/api/admin/uploads', {
      method: 'POST',
      body: { name: 'Head Shot!.png', dataUrl: `data:image/png;base64,${PNG.toString('base64')}` }
    });
    assert.strictEqual(good.status, 201);
    assert.match(good.json.file.name, /^head-shot-[0-9a-f]{8}\.png$/, 'the name is sanitised and made unique');

    const served = await server.call(good.json.file.url);
    assert.strictEqual(served.status, 200);
    assert.strictEqual(served.headers.get('content-type'), 'image/png');

    const listed = await server.call('/api/admin/uploads');
    assert.strictEqual(listed.json.files.length, 1);

    await server.call(`/api/admin/uploads/${good.json.file.name}`, { method: 'DELETE' });
    assert.strictEqual((await server.call('/api/admin/uploads')).json.files.length, 0);
    assert.strictEqual((await server.call(good.json.file.url)).status, 404);
  });
});

test('upload paths cannot escape the store', async () => {
  await withServer({}, async (server) => {
    for (const attempt of ['/uploads/..%2f..%2fserver.js', '/uploads/../../package.json', '/assets/../../server.js']) {
      const res = await server.call(attempt);
      assert.strictEqual(res.status, 404, `${attempt} is refused`);
      assert.ok(!res.text.includes('createServer'), 'no source code leaks');
    }
  });
});

test('following a link counts the click and redirects', async () => {
  await withServer({}, async (server) => {
    const before = (await server.call('/api/content')).json.links.items[0];
    const res = await server.call(`/go/${before.id}`);
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), before.url);

    const after = (await server.call('/api/content')).json.links.items[0];
    assert.strictEqual(after.clicks, before.clicks + 1);

    assert.strictEqual((await server.call('/go/does-not-exist')).status, 404);
  });
});

test('saving against a stale copy is refused', async () => {
  await withServer({}, async (server) => {
    await server.login();
    const res = await server.call('/api/admin/site', {
      method: 'PUT',
      body: { site: { brand: { name: 'Second writer' } }, expectedUpdatedAt: '1999-01-01T00:00:00.000Z' }
    });
    assert.strictEqual(res.status, 409);
    assert.match(res.json.error, /changed in another tab/);
  });
});

test('snapshots are taken on save and can be restored', async () => {
  await withServer({}, async (server) => {
    await server.login();
    await server.call('/api/admin/site', { method: 'PUT', body: { site: { brand: { name: 'First' } } } });
    await server.call('/api/admin/site', { method: 'PUT', body: { site: { brand: { name: 'Second' } } } });

    const backups = (await server.call('/api/admin/backups')).json.backups;
    assert.ok(backups.length >= 2);

    const restored = await server.call('/api/admin/backups/restore', { method: 'POST', body: { name: backups[0].name } });
    assert.strictEqual(restored.status, 200);
    assert.strictEqual(restored.json.site.brand.name, 'First', 'the previous version comes back');
  });
});

test('a restore cannot roll the password back', async () => {
  await withServer({}, async (server) => {
    await server.login();
    await server.call('/api/admin/site', { method: 'PUT', body: { site: { brand: { name: 'Snapshot me' } } } });
    const backups = (await server.call('/api/admin/backups')).json.backups;

    await server.call('/api/admin/password', { method: 'POST', body: { current: 'weed', next: 'new-password' } });

    const fresh = await startServerSession(server);
    await fresh.login('new-password');
    await fresh.call('/api/admin/backups/restore', { method: 'POST', body: { name: backups[0].name } });

    assert.strictEqual((await fresh.login('weed')).status, 401, 'the old password stays dead');
    assert.strictEqual((await fresh.login('new-password')).status, 200);
  });

  // Restoring runs on the same server; this just gives us a clean cookie jar.
  function startServerSession(server) {
    const jar = { cookie: '', csrf: null };
    async function call(pathname, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (jar.cookie) headers.cookie = jar.cookie;
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      if (jar.csrf) headers['x-csrf-token'] = jar.csrf;
      const res = await fetch(server.base + pathname, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: 'manual'
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) jar.cookie = setCookie.split(';')[0];
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_) {
        /* not JSON */
      }
      return { status: res.status, headers: res.headers, text, json };
    }
    return {
      call,
      async login(password) {
        const res = await call('/api/login', { method: 'POST', body: { password } });
        if (res.json && res.json.csrf) jar.csrf = res.json.csrf;
        return res;
      }
    };
  }
});

test('an oversized body gets a 413 rather than a dropped connection', async () => {
  await withServer({}, async (server) => {
    await server.login();
    const res = await server.call('/api/admin/uploads', {
      method: 'POST',
      body: { name: 'huge.png', dataUrl: `data:image/png;base64,${'A'.repeat(13 * 1024 * 1024)}` }
    });
    assert.strictEqual(res.status, 413);
    assert.strictEqual((await server.call('/')).status, 200, 'the server keeps serving afterwards');
  });
});

test('the serverless backend serves the whole site from Redis', async () => {
  const redis = await startFakeRedis();
  try {
    await withServer(
      { VERCEL: '1', KV_REST_API_URL: redis.url, KV_REST_API_TOKEN: redis.token },
      async (server) => {
        const health = await server.call('/healthz');
        assert.strictEqual(health.json.ok, true);
        assert.match(health.json.storage, /Redis/);

        assert.strictEqual((await server.call('/')).status, 200);

        await server.login();
        await server.call('/api/admin/site', { method: 'PUT', body: { site: { home: { subhead: 'Stored in Redis.' } } } });
        assert.match((await server.call('/')).text, /Stored in Redis\./);

        const upload = await server.call('/api/admin/uploads', {
          method: 'POST',
          body: { name: 'photo.png', dataUrl: `data:image/png;base64,${PNG.toString('base64')}` }
        });
        assert.strictEqual(upload.status, 201, 'images work without Blob configured');

        const served = await server.call(upload.json.file.url);
        assert.strictEqual(served.status, 200);
        assert.strictEqual(served.headers.get('content-type'), 'image/png');
        assert.match(served.headers.get('cache-control'), /immutable/);
        assert.ok(served.headers.get('etag'), 'an ETag lets browsers skip the Redis read');
      }
    );
  } finally {
    await redis.close();
  }
});

test('the whole site runs out of a GitHub repository', async () => {
  const gh = await startFakeGithub();
  const env = {
    VERCEL: '1',
    GITHUB_TOKEN: gh.token,
    GITHUB_REPO: `${gh.owner}/${gh.repo}`,
    GITHUB_BRANCH: 'main',
    GITHUB_API_URL: gh.api
  };

  try {
    await withServer(env, async (server) => {
      const health = await server.call('/healthz');
      assert.strictEqual(health.json.ok, true);
      assert.match(health.json.storage, /GitHub repository/);

      assert.strictEqual((await server.call('/')).status, 200);

      // Sessions here are signed rather than stored.
      assert.strictEqual((await server.login('nope')).status, 401);
      assert.strictEqual((await server.login('weed')).status, 200);
      assert.strictEqual((await server.call('/api/session')).json.signedIn, true);

      await server.call('/api/admin/site', { method: 'PUT', body: { site: { home: { subhead: 'Straight from git.' } } } });
      assert.match((await server.call('/')).text, /Straight from git\./);
      assert.match(
        gh.files.get('data/site.json').buffer.toString('utf8'),
        /Straight from git\./,
        'the change is a real file in the repo'
      );

      const upload = await server.call('/api/admin/uploads', {
        method: 'POST',
        body: { name: 'photo.png', dataUrl: `data:image/png;base64,${PNG.toString('base64')}` }
      });
      assert.strictEqual(upload.status, 201);
      assert.ok(gh.files.has('data/uploads/' + upload.json.file.name), 'the image is committed too');

      const served = await server.call(upload.json.file.url);
      assert.strictEqual(served.status, 200);
      assert.strictEqual(served.headers.get('content-type'), 'image/png');

      const backups = (await server.call('/api/admin/backups')).json.backups;
      assert.ok(backups.length >= 1, 'commit history shows up as snapshots');
    });
  } finally {
    await gh.close();
  }
});

test('signed sessions survive a restart, and reject tampering', async () => {
  const gh = await startFakeGithub();
  const env = {
    VERCEL: '1',
    GITHUB_TOKEN: gh.token,
    GITHUB_REPO: `${gh.owner}/${gh.repo}`,
    GITHUB_API_URL: gh.api
  };

  try {
    let cookie = null;
    await withServer(env, async (server) => {
      const res = await server.login('weed');
      assert.strictEqual(res.status, 200);
      cookie = res.headers.get('set-cookie').split(';')[0];
    });

    // A brand new process — nothing was stored anywhere, but the cookie holds.
    await withServer(env, async (server) => {
      const still = await fetch(`${server.base}/api/session`, { headers: { cookie } });
      assert.strictEqual((await still.json()).signedIn, true, 'no session store, yet still signed in');

      const tampered = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
      const forged = await fetch(`${server.base}/api/session`, { headers: { cookie: tampered } });
      assert.strictEqual((await forged.json()).signedIn, false, 'an edited cookie is rejected');
    });
  } finally {
    await gh.close();
  }
});

test('signing out everywhere invalidates an existing signed cookie', async () => {
  const gh = await startFakeGithub();
  const env = {
    VERCEL: '1',
    GITHUB_TOKEN: gh.token,
    GITHUB_REPO: `${gh.owner}/${gh.repo}`,
    GITHUB_API_URL: gh.api
  };

  try {
    await withServer(env, async (server) => {
      const res = await server.login('weed');
      const cookie = res.headers.get('set-cookie').split(';')[0];

      assert.strictEqual((await server.call('/api/admin/sessions', { method: 'DELETE' })).status, 200);

      const after = await fetch(`${server.base}/api/session`, { headers: { cookie } });
      assert.strictEqual((await after.json()).signedIn, false, 'the old generation is dead');

      assert.strictEqual((await server.login('weed')).status, 200, 'and you can sign back in');
    });
  } finally {
    await gh.close();
  }
});

test('changing the password invalidates signed cookies too', async () => {
  const gh = await startFakeGithub();
  const env = {
    VERCEL: '1',
    GITHUB_TOKEN: gh.token,
    GITHUB_REPO: `${gh.owner}/${gh.repo}`,
    GITHUB_API_URL: gh.api
  };

  try {
    await withServer(env, async (server) => {
      const res = await server.login('weed');
      const cookie = res.headers.get('set-cookie').split(';')[0];

      await server.call('/api/admin/password', { method: 'POST', body: { current: 'weed', next: 'a-new-one' } });

      const after = await fetch(`${server.base}/api/session`, { headers: { cookie } });
      assert.strictEqual((await after.json()).signedIn, false, 'the signing key moved with the password');
    });
  } finally {
    await gh.close();
  }
});

test('healthz reports which credentials the build can see, and never their values', async () => {
  const redis = await startFakeRedis();
  try {
    await withServer(
      {
        VERCEL: '1',
        VERCEL_ENV: 'production',
        VERCEL_URL: 'taylosite-xyz.vercel.app',
        VERCEL_GIT_COMMIT_SHA: '8dc330e1234567890',
        VERCEL_GIT_COMMIT_REF: 'main',
        KV_REST_API_URL: redis.url,
        KV_REST_API_TOKEN: redis.token,
        GITHUB_TOKEN: null,
        GH_TOKEN: null,
        INSTAGRAM_TOKEN: null,
        IG_TOKEN: null
      },
      async (server) => {
        const health = (await server.call('/healthz')).json;
        assert.strictEqual(health.ok, true);
        assert.deepStrictEqual(health.credentials, {
          redis: true,
          blob: false,
          github: false,
          instagram: false
        });
        assert.deepStrictEqual(health.build, {
          env: 'production',
          deployment: 'taylosite-xyz.vercel.app',
          commit: '8dc330e',
          branch: 'main'
        });

        const raw = (await server.call('/healthz')).text;
        assert.ok(!raw.includes(redis.token), 'the token itself is never echoed');
        assert.ok(!raw.includes(redis.url), 'nor the store URL');
      }
    );
  } finally {
    await redis.close();
  }
});

test('Blob alone is called out as not enough, and the deployment names itself', async () => {
  await withServer(
    { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: 'taylosite-abc123.vercel.app', BLOB_READ_WRITE_TOKEN: 'blob_test', GITHUB_TOKEN: null, GH_TOKEN: null },
    async (server) => {
      const page = await server.call('/');
      assert.strictEqual(page.status, 503);
      assert.match(page.text, /Blob only stores images/, 'the Blob-is-not-content misconception is named');
      assert.match(page.text, /environment: preview/, 'so you can see this is not production');
      assert.match(page.text, /taylosite-abc123\.vercel\.app/, 'and which deployment it is');
    }
  );
});

test('on Vercel without a store, the site explains itself instead of crashing', async () => {
  await withServer({ VERCEL: '1', GITHUB_TOKEN: null, GH_TOKEN: null }, async (server) => {
    const page = await server.call('/');
    assert.strictEqual(page.status, 503);
    assert.match(page.text, /Setup needed/);
    assert.match(page.text, /GITHUB_TOKEN/, 'the no-extra-service option is offered');
    assert.match(page.text, /Redis/, 'and the database option too');
    assert.match(page.text, /per environment/, 'and the reason a preview build can differ from production');

    const health = await server.call('/healthz');
    assert.strictEqual(health.status, 503);
    assert.strictEqual(health.json.ok, false);

    assert.strictEqual((await server.call('/assets/css/site.css')).status, 200, 'static assets still serve');
  });
});
