'use strict';

const { defaultSite } = require('./defaults');

/**
 * The second half of the generator damage: the prose fields.
 *
 * Every rule here is mechanical. Nothing is written that was not already in the
 * document, because inventing a fact about a person is the mistake being
 * repaired. What it removes is damage with a shape: a pronoun that contradicts
 * the site's own stated gender, a sentence the model stopped in the middle of,
 * the same sentence pasted three times, and a line of interface metadata that
 * ended up inside a biography.
 */

const FEMININE = /^(?:female|woman|she\/her|she\b)/i;

/** Sentences, without splitting "Oh Shit, Did We Just Kill a Guy? (USA) ..." */
function sentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** "Primary button label: Performers." — interface metadata, never biography. */
const INTERFACE_NOISE = /^(?:primary|secondary)?\s*(?:button|cta|nav|menu|link|field|page|section)\s*(?:label|text|title)\s*:/i;

/** A sentence the model stopped in the middle of. */
function incomplete(sentence) {
  return !/[.!?…"”’)]$/.test(String(sentence).trim());
}

/**
 * The description said "He" twice while the biography beside it, and the site's
 * own gender field, both say she. Only ever applied when the site states a
 * feminine gender, and only to third-person singular pronouns.
 */
function correctPronouns(text) {
  return String(text)
    .replace(/\bHe\b/g, 'She')
    .replace(/\bhe\b/g, 'she')
    .replace(/\bHis\b/g, 'Her')
    .replace(/\bhis\b/g, 'her')
    .replace(/\bHim\b/g, 'Her')
    .replace(/\bhim\b/g, 'her');
}

function repairDescription(text, gender) {
  let out = String(text || '');
  if (FEMININE.test(String(gender || '').trim())) out = correctPronouns(out);
  const all = sentences(out);
  const kept = all.filter((s, i) => !(i === all.length - 1 && incomplete(s)));
  return kept.join(' ').trim();
}

/**
 * Sentence-level de-duplication across the biography, in order. A sentence that
 * already appeared — in this paragraph or an earlier one — is dropped, as is a
 * line of interface metadata. A paragraph left empty is removed entirely.
 */
function repairBody(body) {
  const seen = new Set();
  const out = [];
  for (const paragraph of Array.isArray(body) ? body : []) {
    const kept = [];
    for (const sentence of sentences(paragraph)) {
      const key = normalize(sentence);
      if (!key || seen.has(key) || INTERFACE_NOISE.test(sentence)) continue;
      seen.add(key);
      kept.push(sentence);
    }
    const text = kept.join(' ').trim();
    if (text) out.push(text);
  }
  return out;
}

/**
 * A fact whose id matches one the site ships with, and whose stored value has
 * become prose, is restored from that shipped default. The id is the evidence:
 * `fact-base` has always meant "Based in / New York City", so this recovers a
 * known original rather than guessing one.
 */
function repairFacts(facts) {
  const shipped = new Map((defaultSite().about.facts || []).map((f) => [f.id, f]));
  return (Array.isArray(facts) ? facts : []).map((fact) => {
    if (!fact || !shipped.has(fact.id)) return fact;
    const original = shipped.get(fact.id);
    const damaged = (key) => String(fact[key] || '').split(/\s+/).filter(Boolean).length > (key === 'label' ? 6 : 10);
    if (!damaged('label') && !damaged('value')) return fact;
    return {
      ...fact,
      label: damaged('label') ? original.label : fact.label,
      value: damaged('value') ? original.value : fact.value
    };
  });
}

const MARKER = 'proseRepair@1';

function alreadyRun(site) {
  return Array.isArray((site.meta || {}).repairs) && site.meta.repairs.includes(MARKER);
}

function apply(site) {
  const changes = [];
  const note = (path, from, to) => { if (from !== to) changes.push({ path, from, to }); };

  const description = repairDescription(site.seo.description, site.brand.gender);
  note('seo.description', site.seo.description, description);
  site.seo.description = description;

  const body = repairBody(site.about.body);
  note('about.body', JSON.stringify(site.about.body), JSON.stringify(body));
  site.about.body = body;

  const facts = repairFacts(site.about.facts);
  note('about.facts', JSON.stringify(site.about.facts), JSON.stringify(facts));
  site.about.facts = facts;

  site.meta = site.meta || {};
  site.meta.repairs = [...new Set([...(site.meta.repairs || []), MARKER])];
  return { changes };
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
    if (report) for (const c of report.changes) console.log(`[prose-repair] ${c.path} rewritten`);
    return report;
  } catch (err) {
    console.error(`[prose-repair] skipped: ${err.message}`);
    return null;
  }
}

module.exports = { repairDescription, repairBody, repairFacts, sentences, apply, run, alreadyRun, MARKER };
