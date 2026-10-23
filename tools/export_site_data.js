'use strict';
// Export the scored corpus into the shape the site generator wants.
//   node tools/export_site_data.js [data.json]
// Source of truth: data/woke.db (scores, one row per title per source) + data/index.json (names,
// years, types). Theme data comes from data/woke_themes (filled by collect_wokealyzer_categories.js).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const OUT = process.argv[2] || path.join(__dirname, '..', 'data.json');
const SOURCES = ['iiwon', 'iio', 'wokeometer', 'wokealyzer'];

const db = new DatabaseSync(path.join(DATA_DIR, 'woke.db'));

// names/types: the crawl index is keyed by slug, so build an imdbId -> meta map. Rows also carry a
// JSON payload from the source that scored them, which is a second (and often better) name source.
let meta = {};
try {
  const index = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
  for (const v of Object.values(index)) {
    if (v && v.imdbId) meta[v.imdbId] = v;
  }
} catch (e) {
  console.warn('index.json unreadable, falling back to payload names:', e.message);
}

for (const row of db.prepare('select key, payload from woke_scores where payload is not null').all()) {
  if (meta[row.key] && meta[row.key].name) continue;
  try {
    const p = JSON.parse(row.payload);
    const name = p.name || p.title || (p.media && p.media.title) || null;
    if (!name) continue;
    const year = p.year || p.releaseDate && String(p.releaseDate).slice(0, 4) || (p.media && p.media.year) || null;
    const type = p.type || (p.media && p.media.type) || null;
    meta[row.key] = { name, year: year ? Number(year) : null, type: String(type || '').toUpperCase() };
  } catch (e) { /* not json, skip */ }
}

// theme payloads, if the collector has run
let themes = {};
try {
  db.exec('CREATE TABLE IF NOT EXISTS woke_themes (key TEXT PRIMARY KEY, payload TEXT, fetched_at INTEGER)');
  for (const row of db.prepare('select key, payload from woke_themes').all()) {
    try { themes[row.key] = JSON.parse(row.payload); } catch { /* ignore */ }
  }
} catch (e) {
  console.warn('theme table unavailable:', e.message);
}

const byKey = {};
for (const r of db.prepare('select key, source, score from woke_scores where score is not null').all()) {
  if (!SOURCES.includes(r.source)) continue;
  (byKey[r.key] = byKey[r.key] || {})[r.source] = Math.round(r.score);
}

const out = [];
for (const [tt, sc] of Object.entries(byKey)) {
  if (!/^tt\d+$/.test(tt)) continue;             // movies and series only
  const n = Object.keys(sc).length;
  if (n < 2) continue;                            // one score is not an aggregate
  const m = meta[tt] || {};
  const rec = {
    tt,
    type: String(m.type || '').toUpperCase() === 'SERIES' ? 'series' : 'movie',
    name: m.name || tt,
    year: m.year || null,
    tmdb: null,
  };
  for (const s of SOURCES) if (typeof sc[s] === 'number') rec[s] = sc[s];
  const th = themes[tt];
  if (th) {
    rec.details = { wokealyzer: th.wokealyzer || {} };
    if (th.iiwon && th.iiwon.factors) rec.details.iiwon = { factors: th.iiwon.factors };
    if (th.iio && th.iio.reasons) rec.details.iio = { reasons: th.iio.reasons, verdict: th.iio.verdict || '' };
  }
  out.push(rec);
}
out.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
fs.writeFileSync(OUT, JSON.stringify(out, null, 0));
const withThemes = out.filter((r) => r.details).length;
console.log(`exported ${out.length} titles (${withThemes} with theme data) -> ${OUT}`);
