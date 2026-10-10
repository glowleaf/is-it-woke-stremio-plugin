'use strict';
// Smoke test: exercises the real upstreams (Cinemeta + isitwokeornot) through the addon's
// own code paths and prints what the Stremio detail page would get. Run: node test/smoke.js

const path = require('node:path');
const { Store } = require('../src/store');
const { resolve } = require('../src/iiwon');
const iio = require('../src/isitwokeio');
const { decorateMeta } = require('../src/format');
const { fetchBaseMeta } = require('../src/cinemeta');
const { DEFAULTS } = require('../src/config');

const store = new Store(path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'smoke-cache.json'));

function groupRows(links) {
  const rows = {};
  for (const l of links) (rows[l.category] = rows[l.category] || []).push(l.name);
  return rows;
}

const CASES = [
  { id: 'tt1160419', type: 'movie', label: 'Dune (2021)' },
  { id: 'tt12042730', type: 'movie', label: 'Project Hail Mary (2026)' },
  { id: 'tt0944947', type: 'series', label: 'Game of Thrones (isitwoke.io only)' },
  { id: 'tt15239678', type: 'movie', label: 'Dune: Part Two (2024)' },
  { id: 'tt1517268', type: 'movie', label: 'Barbie (2023)' },
  { id: 'tt0133093', type: 'movie', label: 'The Matrix (1999 - before the 2016 cutoff)' },
  { id: 'tt15398776', type: 'movie', label: 'Oppenheimer (2023)' },
];

(async () => {
  let pass = 0;
  let fail = 0;
  for (const c of CASES) {
    const t0 = Date.now();
    let base = null;
    try {
      base = await fetchBaseMeta(DEFAULTS.baseMeta, c.type, c.id, store);
    } catch (err) {
      console.log(`\n${c.label} [${c.id}] - base meta FAILED: ${err.message}`);
      fail += 1;
      continue;
    }
    if (!base) {
      console.log(`\n${c.label} [${c.id}] - Cinemeta has no meta`);
      fail += 1;
      continue;
    }
    const found = await resolve(
      { imdbId: c.id, name: base.name, year: base.releaseInfo ? parseInt(base.releaseInfo, 10) : null, type: c.type },
      store,
    );
    const tmdbId = base.moviedb_id ? String(base.moviedb_id) : '';
    let rating = null;
    if (tmdbId) {
      try {
        rating = await iio.lookup(c.type, tmdbId, store);
      } catch (err) {
        console.log(`   isitwoke.io FAILED: ${err.message}`);
      }
    }
    const ms = Date.now() - t0;
    if (rating) {
      console.log(`   isitwoke.io: ${rating.title} score=${rating.score}% verdict=${rating.verdictLabel} reasons=${rating.reasons.length}`);
    } else {
      console.log(`   isitwoke.io: not rated (tmdb=${tmdbId || 'unknown'})`);
    }
    const results = { iiwon: found.status === 'ok' ? found.title : null, iio: rating };
    if (found.status === 'ok') {
      const t = found.title;
      console.log(`\n${c.label} [${c.id}] via=${found.via} in ${ms}ms`);
      console.log(`   site: ${t.name} (${t.year}) ${t.type} slug=${t.slug} imdb=${t.imdbId}`);
      console.log(`   woke=${t.score}% band=${t.band && t.band.label} imdbRating=${t.imdbRating} rt=${t.rtCritics} runtime=${t.runtime}m`);
      console.log(`   url: https://isitwokeornot.com/${t.type === 'TV_SHOW' ? 'tv' : 'movie'}/${t.slug}`);
      console.log(`   factors: ${t.factors.map((f) => f.label).join(' | ') || '-'}`);
      const rows = groupRows(decorateMeta(base, results, DEFAULTS).links);
      for (const [cat, names] of Object.entries(rows)) console.log(`   ${cat}: ${names.join('  ')}`);
      if (t.imdbId && t.imdbId !== c.id) {
        console.log('   !! imdb mismatch - REJECTED');
        fail += 1;
      } else {
        pass += 1;
      }
    } else {
      console.log(`\n${c.label} [${c.id}] status=${found.status} in ${ms}ms`);
      const rows = groupRows(decorateMeta(base, results, DEFAULTS).links);
      for (const [cat, names] of Object.entries(rows)) console.log(`   ${cat}: ${names.join('  ')}`);
      if (found.status === 'missing') pass += 1;
      else fail += 1;
    }
  }
  console.log(`\n== ${pass} ok / ${fail} failed ==`);
  process.exit(0);
})();
