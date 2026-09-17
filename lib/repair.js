'use strict';

const { identityIssue } = require('../public/assets/js/copy-editor');

/**
 * A one-time repair of identity fields that had prose written over them.
 *
 * Generated copy reached fields whose whole value is that they are exact, and
 * normalizeSite then cut each one to its length mid-word and stored the
 * fragment: a location holding half a biography, a gender reading
 * "Female — Taylor Drew, a New York City st". The renderer already refuses to
 * publish those in structured data, but the stored value is still what the
 * panel shows and what the page prints, so it is repaired at the source.
 *
 * The rule is the same one the panel offers on a button: a value is only
 * rewritten when the original is still recoverable from it — the text standing
 * in front of wherever the sentence started. Where there is no confident
 * original the value is left exactly as it is and named in the report, because
 * inventing a fact about a person is the mistake being repaired, not the fix.
 */

const FIELDS = [
  ['brand', 'location', 'brand.location'],
  ['brand', 'gender', 'brand.gender'],
  ['brand', 'name', 'brand.name'],
  ['brand', 'logoText', 'brand.logoText'],
  ['brand', 'accentLabel', 'brand.accentLabel']
];

/** Returns { changes: [...], skipped: [...] } without touching `site`. */
function plan(site) {
  const changes = [];
  const skipped = [];
  const consider = (path, value, apply) => {
    const issue = identityIssue(path, value);
    if (!issue) return;
    if (!issue.suggestion) return skipped.push({ path, value, reason: issue.expects });
    changes.push({ path, from: value, to: issue.suggestion, apply });
  };

  for (const [section, key, path] of FIELDS) {
    const holder = site[section];
    if (holder) consider(path, holder[key], (target) => { target[section][key] = identityIssue(path, holder[key]).suggestion; });
  }

  const facts = (site.about && site.about.facts) || [];
  facts.forEach((fact, i) => {
    if (!fact) return;
    for (const key of ['label', 'value']) {
      const path = `about.facts.${i}.${key}`;
      consider(path, fact[key], (target) => {
        target.about.facts[i][key] = identityIssue(path, fact[key]).suggestion;
      });
    }
  });

  return { changes, skipped };
}

/**
 * Applied once. The marker lives in the document, so a serverless instance
 * cold-starting for the hundredth time does not re-run it, and an edit made
 * afterwards is never reverted by a later boot.
 */
const MARKER = 'identityRepair@1';

function alreadyRun(site) {
  return Array.isArray((site.meta || {}).repairs) && site.meta.repairs.includes(MARKER);
}

function apply(site) {
  const { changes, skipped } = plan(site);
  for (const change of changes) change.apply(site);
  site.meta = site.meta || {};
  site.meta.repairs = [...new Set([...(site.meta.repairs || []), MARKER])];
  return { changes, skipped };
}

/**
 * Runs at most once per site document. Never throws into the request path: a
 * site that cannot be repaired must still be served.
 */
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
    if (report && report.changes.length) {
      for (const c of report.changes) console.log(`[repair] ${c.path}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
    }
    if (report && report.skipped.length) {
      for (const s of report.skipped) console.log(`[repair] left alone, no confident original: ${s.path}`);
    }
    return report;
  } catch (err) {
    console.error(`[repair] skipped: ${err.message}`);
    return null;
  }
}

module.exports = { plan, apply, run, alreadyRun, MARKER };
