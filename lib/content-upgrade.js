'use strict';

/**
 * The copy the generator left behind, brought up to the standard the rest of
 * the site already meets.
 *
 * This is not the mechanical repair in prose-repair.js. These are authored
 * replacements, and every claim in them is taken from the site's own credits,
 * FAQs and links — nothing is added that the document did not already assert
 * somewhere. Two of them correct a fact the generator got backwards.
 *
 * Each entry only applies while the field still holds the exact text audited
 * here, so an edit made in the panel is never overwritten.
 */

// Her own credits list says: League of Comics — Judge. Pins & Needles Comedy —
// Creator and host. The generated biography had those two swapped, calling her
// a judge on her own show and listing League of Comics among festivals she
// performs at. An answer engine reading that repeats a credit she does not have
// and drops the one she does.
const BODY = [
  'Taylor Drew is a stand-up comedian based in New York City. She performs regularly at clubs across the city, has been featured at the Comedy Store in Los Angeles, and won the 2025 Roast Battle at Skankfest. Her festival appearances include the Edinburgh Fringe and Laughing Buddha.',
  'She created and hosts Pins & Needles Comedy, a New York show built around heavily tattooed comics, and judges League of Comics. A SAG-Eligible performer and award-winning writer, her credits include Orange Is the New Black, a Crown Royal NFL campaign, and voice work for LumiLED and Crunch Candy. Her short film Oh Shit, Did We Just Kill a Guy? won Best Writer in the Super Short category at the Alternative Film Festival.'
];

const FIELDS = [
  // Both were accurate but overran what a search result shows, so the part that
  // identifies her was the part getting cut off.
  {
    path: 'seo.title',
    was: 'Taylor Drew | NYC Stand-Up Comedian, Skankfest Battle Winner & Pins & Needles Creator',
    now: 'Taylor Drew — NYC Stand-Up Comedian & Roast Battle Winner'
  },
  {
    path: 'seo.description',
    was: 'Taylor Drew is a New York City stand-up comedian who performs regularly at top NYC clubs. She has been featured at the Comedy Store in Los Angeles and festivals including Skankfest, Edinburgh Fringe, Laughing Buddha Comedy Festival. Taylor Drew won the Roast Battle competition at the League of Comics event.',
    now: 'Taylor Drew is a New York City stand-up comedian, 2025 Skankfest Roast Battle winner and creator of Pins & Needles Comedy. Dates, clips and booking.'
  },
  // "Discover ... Experience ..." is advertising voice. An answer engine quotes
  // a sentence that states something; it has nothing to do with a sentence that
  // instructs the reader to feel enthusiasm.
  {
    path: 'home.subhead',
    was: 'Discover Taylor Drew, a stand-up comedian hailing from New York City. Experience her unique humor at top NYC clubs and watch as she captivates audiences with sharp wit.',
    now: 'Live stand-up across New York City, clips from recent sets and dates for the next show. Taylor Drew won the 2025 Skankfest Roast Battle and created Pins & Needles Comedy.'
  },
  // Alt text that opens "A person" describes a stock photo. Naming the subject
  // is what connects the image to the entity in image search.
  {
    path: 'home.photoAlt',
    was: 'A person with blonde hair, wearing a white shirt and blue overalls, with a tattoo on their left arm.',
    now: 'Taylor Drew, blonde hair, wearing a white shirt and blue overalls, with a tattoo on her left arm.'
  },
  {
    path: 'about.photoAlt',
    was: 'A person with a blurred face is holding a microphone, likely speaking at an event in New York City. Taylor Drew is a stand-up comedian who performs regularly at',
    now: 'Taylor Drew holding a microphone mid-set, performing stand-up in New York City.'
  },
  {
    path: 'seo.ogImageAlt',
    was: 'A person with a blurred face wearing a white shirt and blue overalls with a tattoo on their arm, standing against a dark background.',
    now: 'Taylor Drew in a white shirt and blue overalls, a tattoo on her arm, against a dark background.'
  },
  // A hashtag is not a sentence, and the line stopped before it said anything.
  {
    path: 'reels.intro',
    was: 'Taylor Drew, a New York City stand-up comedian performing at top clubs. #NYCcomedy #TaylorDrew #ReelsLife',
    now: 'Short clips from recent sets around New York City.'
  },
  { path: 'links.intro', was: '', now: 'Every profile, project and booking address for Taylor Drew in one place.' },
  { path: 'photos.intro', was: '', now: 'Performance photos and portraits of Taylor Drew.' }
];

// A link with no description tells a reader, and a crawler, nothing about where
// it goes. Each of these says what is on the other end, from the site's own
// credits and FAQs.
const SUBLABELS = {
  'https://instagram.com/taylordrew4u': 'Clips from recent sets, posted between shows.',
  'https://podcasts.apple.com/us/podcast/taylordrew4u/id1719827840': 'Her podcast, on Apple Podcasts.',
  'https://www.imdb.com/name/nm6287452/': 'Screen credits, including Orange Is the New Black.',
  'https://pinsandneedlescomedy.com': 'The New York show she created and hosts for heavily tattooed comics.',
  'https://ohshitdidwejustkillaguy.com': 'Oh Shit, Did We Just Kill a Guy? — Best Writer, Alternative Film Festival.',
  'mailto:taylordrew4u@gmail.com': 'Enquiries for dates, festivals and press.'
};

const MARKER = 'contentUpgrade@1';

function get(site, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), site);
}

function set(site, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const holder = keys.reduce((value, key) => (value == null ? undefined : value[key]), site);
  if (holder) holder[last] = value;
}

function alreadyRun(site) {
  return Array.isArray((site.meta || {}).repairs) && site.meta.repairs.includes(MARKER);
}

function apply(site) {
  const changes = [];
  const skipped = [];

  for (const field of FIELDS) {
    const current = String(get(site, field.path) == null ? '' : get(site, field.path));
    if (current !== field.was) { skipped.push({ path: field.path, reason: 'edited since the audit' }); continue; }
    set(site, field.path, field.now);
    changes.push({ path: field.path, from: field.was, to: field.now });
  }

  // The swapped credit is the condition, not the shape of the biography: while
  // any paragraph still calls Pins & Needles Comedy something she judges, the
  // text is the generated one and the correction applies. Once it is gone —
  // fixed here or edited in the panel — this never fires again.
  const body = (site.about && site.about.body) || [];
  if (body.some((p) => /judge[sd]?\s+on\s+Pins\s*&\s*Needles/i.test(String(p)))) {
    changes.push({ path: 'about.body', from: JSON.stringify(body), to: JSON.stringify(BODY) });
    site.about.body = BODY.slice();
  } else {
    skipped.push({ path: 'about.body', reason: 'edited since the audit' });
  }

  for (const link of (site.links && site.links.items) || []) {
    const text = SUBLABELS[String(link && link.url)];
    if (!text) continue;
    const current = String(link.sublabel || '');
    // An empty description, or the placeholder that was the account handle.
    if (current && current !== 'TAYLORDREW4U') { skipped.push({ path: `links (${link.url})`, reason: 'already described' }); continue; }
    link.sublabel = text;
    changes.push({ path: `links (${link.label})`, from: current, to: text });
  }

  site.meta = site.meta || {};
  site.meta.repairs = [...new Set([...(site.meta.repairs || []), MARKER])];
  return { changes, skipped };
}

async function run(store) {
  try {
    const current = await store.readSite();
    if (alreadyRun(current)) return null;
    let report = null;
    await store.update((site) => {
      if (alreadyRun(site)) return site;
      report = apply(site);
      return site;
    });
    if (report) {
      for (const c of report.changes) console.log(`[content] ${c.path} rewritten`);
      for (const s of report.skipped) console.log(`[content] left alone: ${s.path} (${s.reason})`);
    }
    return report;
  } catch (err) {
    console.error(`[content] skipped: ${err.message}`);
    return null;
  }
}

module.exports = { apply, run, alreadyRun, MARKER, FIELDS, SUBLABELS, BODY };
