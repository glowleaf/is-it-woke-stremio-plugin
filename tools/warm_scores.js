'use strict';
// Warm the score cache in bulk: walk data/index.json (every title the catalogue crawl found) and
// resolve ALL sources for each one, so the browse catalogs can rank on the aggregate and every
// title page answers from SQLite. Resumable - the SQLite rows themselves are the checkpoint, so
// re-running only fills what is missing.
//
//   node tools/warm_scores.js                # ~3 requests/second, all remaining titles
//   node tools/warm_scores.js --limit 50     # just the first 50 needing work
//   node tools/warm_scores.js --rate 1.5     # gentler with the smaller sites

const fs = require('node:fs');
const path = require('node:path');

const { Store } = require('../src/store');
const { ScoreDB } = require('../src/db');
const { resolve, bandOf } = require('../src/iiwon');
const { fetchBaseMeta } = require('../src/cinemeta');
const iio = require('../src/isitwokeio');
const { EXTRA_SOURCES } = require('../src/extra');
const { DEFAULTS } = require('../src/config');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const RATE = Math.max(0.2, Number(argOf('rate', 3)) || 3);
const LIMIT = Number(argOf('limit', 0)) || Infinity;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SOURCE_KEYS = ['iiwon', 'iio', ...EXTRA_SOURCES.map((s) => s.key)];

async function main() {
  const store = new Store(path.join(DATA_DIR, 'cache.json'));
  const db = new ScoreDB(path.join(DATA_DIR, 'woke.db'));

  let index = {};
  try {
    index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  } catch (err) {
    console.error(`cannot read ${INDEX_FILE}: ${err.message}`);
    process.exit(1);
  }

  const all = Object.values(index).filter((r) => r && r.imdbId);

  // The index was built by crawling isitwokeornot.com, so it already holds that site's score for
  // every title. Seed those rows straight from it instead of asking the site again - that removes
  // two requests per title from this run.
  let seeded = 0;
  for (const r of all) {
    if (db.lookup(r.imdbId).iiwon) continue;
    if (!Number.isFinite(r.score)) continue;
    const band = bandOf(r.score);
    db.save(r.imdbId, 'iiwon', 'ok', {
      site: 'isitwokeornot.com',
      slug: r.slug,
      name: r.name,
      type: r.type,
      year: r.year,
      score: r.score,
      band,
      summary: '',
      factors: [],
      imdbId: r.imdbId,
      url: `https://isitwokeornot.com/${r.type === 'TV_SHOW' ? 'tv' : 'movie'}/${r.slug}`,
      seededFromIndex: true,
    });
    seeded += 1;
  }
  if (seeded) console.log(`[warm] seeded ${seeded} editorial rows from the index`);

  const todo = all.filter((r) => {
    const hit = db.lookup(r.imdbId);
    return !SOURCE_KEYS.every((k) => hit[k]);
  });
  console.log(`[warm] ${all.length} indexed titles, ${todo.length} need work`);
  if (!todo.length) return;

  let done = 0;
  let added = 0;
  let errors = 0;
  let nextSlot = 0;

  // Per-source pacing: isitwoke.io rate-limits this box (429), and a global backoff there was
  // stalling the other sources too. Each source gets its own slot and its own backoff.
  const slots = new Map();
  async function paced(name, fn) {
    const now = Date.now();
    const next = slots.get(name) || 0;
    const wait = Math.max(0, next - now);
    slots.set(name, Math.max(now, next) + 1000 / RATE);
    if (wait) await sleep(wait);
    try {
      return await fn();
    } catch (err) {
      if (/\b429\b/.test(err.message)) {
        console.warn(`[warm] ${name} 429 - backing off 30s`);
        await sleep(30000);
      }
      throw err;
    }
  }

  for (const row of todo) {
    if (done >= LIMIT) break;
    const type = row.type === 'TV_SHOW' ? 'series' : 'movie';
    const key = row.imdbId;
    const hit = db.lookup(key);

    let base = null;
    if (!hit.iiwon || !hit.iio || !hit.wokeometer) {
      try {
        base = await paced('cinemeta', () => fetchBaseMeta(DEFAULTS.baseMeta, type, key, store));
      } catch (err) {
        errors += 1;
        continue;
      }
    }
    const name = (base && base.name) || row.name || '';
    const tmdbId = base && base.moviedb_id ? String(base.moviedb_id) : '';
    const year = base && base.releaseInfo ? parseInt(base.releaseInfo, 10) : row.year || null;

    // Fast, unthrottled sources first so titles reach 2+ scores quickly (that is what the
    // catalogs rank on); isitwoke.io last because it rate-limits this box.
    for (const src of EXTRA_SOURCES) {
      if (hit[src.key]) continue;
      try {
        const rating = await paced(src.key, () => src.lookup(type, tmdbId, key, name));
        db.save(key, src.key, rating ? 'ok' : 'missing', rating || null);
        if (rating) added += 1;
      } catch (err) { errors += 1; }
    }
    if (!hit.iio && tmdbId) {
      try {
        const rating = await paced('iio', () => iio.lookup(type, tmdbId, store));
        db.save(key, 'iio', rating ? 'ok' : 'missing', rating || null);
        if (rating) added += 1;
      } catch (err) { errors += 1; }
    }
    if (!hit.iiwon) {
      try {
        const found = await paced('iiwon', () => resolve({ imdbId: key, name, year, type }, store));
        if (found.status === 'ok') { db.save(key, 'iiwon', 'ok', found.title); added += 1; }
        else if (found.status === 'missing') db.save(key, 'iiwon', 'missing');
      } catch (err) { errors += 1; }
    }

    done += 1;
    if (done % 25 === 0) {
      const stats = db.stats();
      console.log(`[warm] ${done}/${todo.length} done - ${added} scores stored, ${errors} errors, db now ${stats.titles} titles / ${stats.rows} rows`);
    }
  }

  const stats = db.stats();
  console.log(`[warm] finished: ${done} titles processed, ${added} scores stored, ${errors} errors - db ${stats.titles} titles / ${stats.rows} rows`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
