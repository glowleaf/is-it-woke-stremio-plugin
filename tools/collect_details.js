'use strict';
/**
 * Collect everything each source publishes about a title, not just the number.
 *
 *   node tools/collect_details.js compare.json details.json
 *
 * What comes back per title:
 *   iiwon      factors with weights ("Woke representation / casting" 25), summary, RT/MC numbers
 *   iio        reasons: the sentences the site itself uses to justify the verdict
 *   wokealyzer 5 rubric categories + its one line review
 *   wokeometer score only (it publishes no breakdown)
 * The site then explains a spread with the sources' own reasoning instead of restating the table.
 */
const fs = require('node:fs');
const { fetchBaseMeta } = require('../src/cinemeta');
const iiwon = require('../src/iiwon');
const iio = require('../src/isitwokeio');
const { lookupWokeometer } = require('../src/extra');
const { getJson, getText } = require('../src/http');

const mem = { get: () => undefined, set: () => {} };
const CINEMETA = 'https://v3-cinemeta.strem.io';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wokealyzerDetail(tt, type) {
  const kind = type === 'series' ? 'series' : 'movie';
  try {
    const html = await getText(`https://www.wokealyzer.com/${kind}/${tt}`);
    const h = html.replace(/\\"/g, '"');
    const m = h.match(/"overallScore":([\d.]+)[\s\S]{0,4000}?"scores":\{([^}]*)\}/);
    const one = h.match(/"oneLineReview":"([^"\\]{10,200})"/);
    const cats = m ? Object.fromEntries([...m[2].matchAll(/"(\w+)":([\d.]+)/g)].map((x) => [x[1], Number(x[2])])) : null;
    return { categories: cats, oneLine: one ? one[1] : null };
  } catch (e) {
    return { error: e.message.slice(0, 60) };
  }
}

async function one(row) {
  const out = { ...row, details: {} };
  const type = row.type || 'movie';
  let base = null;
  try {
    base = await fetchBaseMeta(CINEMETA, type, row.tt, mem);
  } catch (e) { /* cinemeta is only for the tmdb id */ }
  const tmdb = row.tmdb || (base && base.moviedb_id) || null;
  const name = row.name || (base && base.name) || row.tt;
  out.tmdb = tmdb;

  try {
    const r = await iiwon.resolve({ imdbId: row.tt, name, year: row.year || (base && base.year), type }, mem);
    if (r.status === 'ok') {
      const t = r.title;
      out.iiwon = Math.round(t.score);
      out.details.iiwon = {
        factors: (t.factors || []).map((f) => ({ label: f.label, weight: f.weight })),
        summary: (t.summary || '').slice(0, 300),
        rt: t.rtCritics, rtAudience: t.rtAudience, mc: t.metacritic,
        band: t.band && t.band.label,
      };
    }
  } catch (e) { /* leave null */ }
  await sleep(1100);

  if (tmdb) {
    try {
      const v = await iio.lookup(type, tmdb, mem);
      if (v) {
        out.iio = Math.round(v.score);
        out.details.iio = { reasons: (v.reasons || []).slice(0, 3), verdict: v.verdictLabel };
      }
    } catch (e) { /* leave null */ }
    await sleep(1100);
    try {
      const w = await lookupWokeometer(type, tmdb, row.tt, name);
      if (w) out.wokeometer = w.score;
    } catch (e) { /* leave null */ }
    await sleep(1100);
  }

  const wa = await wokealyzerDetail(row.tt, type);
  if (!row.wokealyzer && wa.categories && Object.keys(wa.categories).length) {
    const vals = Object.values(wa.categories);
    out.wokealyzer = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10);
  }
  out.details.wokealyzer = wa;
  await sleep(1100);
  return out;
}

(async () => {
  const src = process.argv[2] || 'compare.json';
  const dst = process.argv[3] || 'details.json';
  const rows = JSON.parse(fs.readFileSync(src, 'utf8'));
  const out = [];
  for (const row of rows) {
    const r = await one(row);
    out.push(r);
    const d = r.details;
    console.log(`${r.tt} ${String(r.name).slice(0, 24).padEnd(24)} iiwon:${r.iiwon || '-'} factors:${(d.iiwon && d.iiwon.factors.length) || 0} iio:${r.iio || '-'} reasons:${(d.iio && d.iio.reasons.length) || 0} wza cats:${(d.wokealyzer && d.wokealyzer.categories && Object.keys(d.wokealyzer.categories).length) || 0}`);
  }
  fs.writeFileSync(dst, JSON.stringify(out, null, 1));
  console.log('written:', dst);
})();
