'use strict';
// Lean collector for theme-level data: wokealyzer's rubric categories, isitwokeornot's weighted
// factors, isitwoke.io's reason sentences. Every call is time-boxed so one slow site cannot stall
// the build (the full collector hung on a source with no timeout).
const fs = require('node:fs');
const iiwon = require('../src/iiwon');
const iio = require('../src/isitwokeio');
const { getText } = require('../src/http');

const mem = { get: () => undefined, set: () => {} };
const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + label)), ms))]);

async function wokealyzer(tt, type) {
  const kind = type === 'series' ? 'series' : 'movie';
  const html = await withTimeout(getText(`https://www.wokealyzer.com/${kind}/${tt}`), 20000, 'wokealyzer');
  const unesc = html.split('\\"').join('"');
  const m = unesc.match(/"overallScore":([\d.]+)[\s\S]{0,4000}?"scores":\{([^}]*)\}/);
  const one = html.match(/oneLineReview\\":\\"(.{10,220}?)\\"/);
  const cats = m
    ? Object.fromEntries([...m[2].matchAll(/"(\w+)":([\d.]+)/g)].map((x) => [x[1], Number(x[2])]))
    : null;
  // The per-category justification text: this is where the sources actually describe boss-babe
  // framing or male characters being written as useless, so it is what the derived rows quote.
  const ex = unesc.match(/"explanations":\{"identityPolitics":"([\s\S]*?)","oikophobia":"([\s\S]*?)","feminism":"([\s\S]*?)","lgbtq":"([\s\S]*?)","antiTheism":"([\s\S]*?)"\}/);
  const explanations = ex
    ? { identityPolitics: ex[1], oikophobia: ex[2], feminism: ex[3], lgbtq: ex[4], antiTheism: ex[5] }
    : null;
  return { categories: cats, oneLine: one ? one[1] : null, explanations };
}

(async () => {
  const rows = JSON.parse(fs.readFileSync(process.argv[2] || 'compare.json', 'utf8'));
  const out = [];
  for (const row of rows) {
    const type = row.type || 'movie';
    const rec = { ...row, details: {} };
    try {
      const r = await withTimeout(
        iiwon.resolve({ imdbId: row.tt, name: row.name, year: row.year, type }, mem), 25000, 'iiwon');
      if (r.status === 'ok') {
        rec.iiwon = Math.round(r.title.score);
        rec.details.iiwon = { factors: (r.title.factors || []).map((f) => ({ label: f.label, weight: f.weight })) };
      }
    } catch (e) { rec.details.iiwon_error = e.message; }

    try {
      const v = row.tmdb ? await withTimeout(iio.lookup(type, row.tmdb, mem), 25000, 'iio') : null;
      if (v) {
        rec.iio = Math.round(v.score);
        rec.details.iio = { reasons: (v.reasons || []).slice(0, 2), verdict: v.verdictLabel };
      }
    } catch (e) { rec.details.iio_error = e.message; }

    try { rec.details.wokealyzer = await wokealyzer(row.tt, type); }
    catch (e) { rec.details.wokealyzer = { error: e.message }; }

    const cats = rec.details.wokealyzer && rec.details.wokealyzer.categories;
    if (cats && Object.keys(cats).length) {
      const v = Object.values(cats);
      if (!rec.wokealyzer) rec.wokealyzer = Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10);
    }
    out.push(rec);
    const f = (rec.details.iiwon && rec.details.iiwon.factors.length) || 0;
    const c = (cats && Object.keys(cats).length) || 0;
    const rr = (rec.details.iio && rec.details.iio.reasons.length) || 0;
    console.log(`${row.tt} ${String(row.name).slice(0, 22).padEnd(22)} factors:${f} wza:${c} iio:${rr}`);
  }
  fs.writeFileSync(process.argv[3] || 'themes.json', JSON.stringify(out, null, 1));
  console.log('written:', process.argv[3] || 'themes.json');
})();
