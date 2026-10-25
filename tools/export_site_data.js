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
    const tmdb = p.tmdbId || p.tmdb_id || (p.media && p.media.tmdb_id) || null;
    const poster = p.poster || (p.media && p.media.poster) || null;
    meta[row.key] = { name, year: year ? Number(year) : null, type: String(type || '').toUpperCase(), tmdb: tmdb ? Number(tmdb) : null, poster };
  } catch (e) { /* not json, skip */ }
}

// Hand-written / AI-written analysis for titles that have it, kept across re-exports
let extrasFile = {};
try { extrasFile = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'site-extras.json'), 'utf8')); } catch (e) { /* none */ }

// popularity / rating captured by tools/enrich_tmdb.js (drives "popular first" batching)
let extMeta = {};
try {
  for (const row of db.prepare('select key, popularity, imdb from meta_ext').all()) extMeta[row.key] = row;
} catch (e) { /* fills on the first enrichment run */ }

// TMDB ids filled in by tools/enrich_tmdb.js (isitwoke.io is keyed by them)
try {
  for (const row of db.prepare('select key, id from tmdb').all()) {
    if (!row.id) continue;
    meta[row.key] = Object.assign({}, meta[row.key] || {}, { tmdb: Number(row.id) });
  }
} catch (e) { /* table fills on the first enrichment run */ }

// AI summaries written by tools/ai_summary.js, one JSON per title
let aiFiles = {};
try {
  for (const f of fs.readdirSync(path.join(DATA_DIR, 'ai-summary'))) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ai-summary', f), 'utf8'));
    if (j && j.tt && j.summary) aiFiles[j.tt] = j;
  }
} catch (e) { /* none yet */ }

// script analyses written by tools/script_analysis.js, one JSON per title
let scriptAnalyses = {};
try {
  for (const f of fs.readdirSync(path.join(DATA_DIR, 'script-analysis'))) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'script-analysis', f), 'utf8'));
    if (j && j.tt && j.analysis) scriptAnalyses[j.tt] = j;
  }
} catch (e) { /* none yet */ }

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
    poster: (extMeta[tt] && extMeta[tt].poster) || m.poster || null,
    popularity: (extMeta[tt] && extMeta[tt].popularity) || 0,
    imdb: (extMeta[tt] && extMeta[tt].imdb) || null,
    tmdb: m.tmdb || null,
  };
  for (const s of SOURCES) if (typeof sc[s] === 'number') rec[s] = sc[s];
  const ai = aiFiles[tt];
  if (ai) {
    rec.aiSummary = ai.summary;
    if (ai.verdict) rec.aiVerdict = ai.verdict;
    if (ai.themesAI) rec.themesAI = ai.themesAI;
    if (ai.synopsis) rec.synopsis = ai.synopsis;
  }
  if (scriptAnalyses[tt]) rec.scriptAnalysis = scriptAnalyses[tt];
  if (extrasFile[tt]) Object.assign(rec, extrasFile[tt]);
  const th = themes[tt];
  if (th) {
    rec.details = { wokealyzer: th.wokealyzer || {} };
    if (th.iiwon && th.iiwon.factors) rec.details.iiwon = { factors: th.iiwon.factors };
    if (th.iio && th.iio.reasons) rec.details.iio = { reasons: th.iio.reasons, verdict: th.iio.verdict || '' };
  }
  out.push(rec);
}
// games: seeded by tools/seed_games.js, single-source by nature
let games = [];
try { games = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8')); } catch (e) { /* none */ }
const have = new Set(out.map((r) => r.tt));
for (const g of games) if (g && g.tt && !have.has(g.tt)) out.push(g);

out.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
fs.writeFileSync(OUT, JSON.stringify(out, null, 0));
const withThemes = out.filter((r) => r.details).length;
console.log(`exported ${out.length} titles (${withThemes} with theme data, ${out.filter((r) => r.scriptAnalysis).length} with script analysis) -> ${OUT}`);
