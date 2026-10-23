'use strict';
// Compare every woke-score source we know on a spread of titles, so weighting is a decision made on
// data: coverage, mean level, pairwise agreement (Pearson + Spearman), and who is the outlier.
//
// Run: node tools/compare_sources.js [out.json]

const fs = require('fs');
const { fetchBaseMeta } = require('../src/cinemeta');
const iiwon = require('../src/iiwon');
const iio = require('../src/isitwokeio');
const { lookupWokeometer, lookupWokealyzer } = require('../src/extra');

const TITLES = [
  ['tt1457767', 'movie'], ['tt1160419', 'movie'], ['tt15398776', 'movie'],
  ['tt1745960', 'movie'], ['tt10366206', 'movie'], ['tt0816692', 'movie'],
  ['tt0133093', 'movie'], ['tt0111161', 'movie'], ['tt0110912', 'movie'],
  ['tt1877830', 'movie'], ['tt1517268', 'movie'], ['tt6791350', 'movie'],
  ['tt1375666', 'movie'], ['tt0120737', 'movie'], ['tt4154796', 'movie'],
  ['tt7286456', 'movie'],
  ['tt0944947', 'series'], ['tt0903747', 'series'], ['tt4574334', 'series'],
  ['tt0386676', 'series'], ['tt0108778', 'series'], ['tt8111088', 'series'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// adapters expect a cache object; the comparison runs cold on purpose
const memStore = { get: () => undefined, set: () => {} };
const CINEMETA = 'https://v3-cinemeta.strem.io';

async function one(tt, type) {
  const row = { tt, type, name: null, iiwon: null, iio: null, wokeometer: null, wokealyzer: null };
  let base = null;
  try {
    base = await fetchBaseMeta(CINEMETA, type, tt, memStore);
  } catch (e) {
    row.error = 'cinemeta: ' + e.message;
    return row;
  }
  if (!base) { row.error = 'no cinemeta meta'; return row; }
  row.name = base.name;
  row.year = base.year;
  const tmdb = base.moviedb_id;
  row.tmdb = tmdb || null;

  const jobs = [
    ['iiwon', async () => {
      const r = await iiwon.resolve({ imdbId: tt, name: base.name, year: base.year, type }, memStore);
      return r && r.status === 'ok' ? r.title : null;
    }],
    ['iio', async () => (tmdb ? iio.lookup(type, tmdb, memStore) : null)],
    ['wokeometer', async () => lookupWokeometer(type, tmdb, tt, base.name)],
    ['wokealyzer', async () => lookupWokealyzer(type, tmdb, tt, base.name)],
  ];
  for (const [key, fn] of jobs) {
    try {
      const r = await fn();
      if (r && typeof r.score === 'number') row[key] = Math.round(r.score);
    } catch (e) {
      row[key] = null;
      row[key + '_err'] = e.message.slice(0, 60);
    }
    await sleep(1100); // politeness: one request per second per host
  }
  return row;
}

(async () => {
  const out = [];
  for (const [tt, type] of TITLES) {
    const row = await one(tt, type);
    out.push(row);
    const cells = ['iiwon', 'iio', 'wokeometer', 'wokealyzer'].map((k) => (row[k] === null ? '  -' : String(row[k]).padStart(3)));
    console.log(`${tt} ${String(row.name || row.error || '?').slice(0, 28).padEnd(28)} ${cells.join(' ')}`);
  }
  const target = process.argv[2] || 'compare.json';
  fs.writeFileSync(target, JSON.stringify(out, null, 1));
  console.log('written:', target);
})();
