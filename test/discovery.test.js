'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultSite } = require('../lib/defaults');
const render = require('../lib/render');
const { siteUrls } = require('../lib/indexnow');
const origin = 'https://www.taylordrew4u.com';
const graph = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])['@graph'];

test('shows are readable in the initial HTML and hidden dates remain private', () => {
  const site = defaultSite();
  site.shows = [
    { id: 'next', date: '2099-01-01', venue: 'Future Club', visible: true },
    { id: 'past', date: '2001-01-01', venue: 'Past Club', visible: true },
    { id: 'private', date: '2099-01-01', venue: 'Private Club', visible: false }
  ];
  const html = render.renderShows(site, { origin });
  assert.match(html, /Future Club/);
  assert.match(html, /Past Club/);
  assert.doesNotMatch(html, /Private Club/);
  assert.match(html, /rel="canonical" href="https:\/\/www.taylordrew4u.com\/shows"/);
  const events = graph(html).filter((node) => node['@type'] === 'Event');
  assert.equal(events.length, 1);
  assert.equal(events[0].organizer, undefined, 'performing does not imply organizing');
  assert.ok(siteUrls(origin).includes(`${origin}/shows`));
  assert.match(render.llmsTxt(site, origin), /\[Shows\]/);
});

test('absolute image URLs remain valid in structured data', () => {
  const site = defaultSite();
  site.home.photo = 'https://images.example.com/photo.jpg';
  site.about.photo = '/uploads/about.jpg';
  const images = graph(render.renderAbout(site, { origin })).filter((node) => node['@type'] === 'ImageObject');
  assert.equal(images[0].url, site.home.photo);
  assert.equal(images[1].url, `${origin}/uploads/about.jpg`);
});

test('profile links expose the destination while keeping the click counter available', () => {
  const site = defaultSite();
  site.links.items = [{ id: 'instagram', label: 'Instagram', url: 'https://instagram.com/taylordrew4u', visible: true }];
  assert.match(render.renderLinks(site, { origin }), /href="https:\/\/instagram.com\/taylordrew4u" data-tracked-link="\/go\/instagram"/);
  assert.match(render.renderShows(site, { origin }), /No upcoming dates are listed/);
});
