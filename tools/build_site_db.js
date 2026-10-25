'use strict';
// Build the SQLite database the PHP site reads. Replaces the static HTML generator: data lives in one
// file, pages are rendered per request and cached.
//
//   node tools/build_site_db.js [data.json] [site.db]
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA = path.resolve(process.argv[2] || 'data.json');
const DB = path.resolve(process.argv[3] || path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'site.db'));
const POSTERS = path.join(path.dirname(DB), 'posters');

const WEIGHTS = { iiwon: 1, iio: 1, wokeometer: 1, wokealyzer: 2, wokemovie: 1, wokenessratings: 1, virtuevigil: 1 };
const KEYS = Object.keys(WEIGHTS);
const BANDS = [
  { max: 19, label: 'Absolute Cinema', colour: '#22c55e' },
  { max: 39, label: 'Very Little Woke', colour: '#84cc16' },
  { max: 59, label: 'Slightly Woke', colour: '#f59e0b' },
  { max: 79, label: 'Very Woke', colour: '#f97316' },
  { max: 100, label: 'Certified Woke', colour: '#ef4444' },
];
const bandOf = (v) => BANDS.find((b) => v <= b.max) || BANDS[BANDS.length - 1];

function aggregate(row) {
  const scored = KEYS.filter((k) => typeof row[k] === 'number').map((k) => ({ k, v: row[k], w: WEIGHTS[k] }));
  if (!scored.length) return null;
  const total = scored.reduce((a, s) => a + s.v * s.w, 0);
  const weight = scored.reduce((a, s) => a + s.w, 0);
  const vals = scored.map((s) => s.v).sort((a, b) => a - b);
  return {
    avg: Math.round(total / weight),
    spread: vals[vals.length - 1] - vals[0],
    n: scored.length,
    single: scored.length === 1 ? scored[0].k : null,
  };
}

const rows = JSON.parse(fs.readFileSync(DATA, 'utf8')).filter((r) => r && r.tt && r.name);
fs.mkdirSync(path.dirname(DB), { recursive: true });
if (fs.existsSync(DB)) fs.unlinkSync(DB);
const db = new DatabaseSync(DB);
db.exec(`CREATE TABLE titles (
  tt TEXT PRIMARY KEY, type TEXT, name TEXT, year INTEGER, poster TEXT,
  popularity REAL, imdb REAL, tmdb INTEGER, score INTEGER, spread INTEGER, n INTEGER,
  band TEXT, colour TEXT, single_source TEXT, scores TEXT, themes TEXT,
  summary TEXT, verdict TEXT, script TEXT, updated INTEGER
)`);
db.exec('CREATE INDEX idx_type_score ON titles(type, score DESC)');
db.exec('CREATE INDEX idx_pop ON titles(popularity DESC)');
db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');

const insert = db.prepare(`INSERT OR REPLACE INTO titles
  (tt,type,name,year,poster,popularity,imdb,tmdb,score,spread,n,band,colour,single_source,scores,themes,summary,verdict,script,updated)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

let ok = 0;
const now = Date.now();
for (const r of rows) {
  const agg = aggregate(r);
  if (!agg) continue;
  const posterFile = path.join(POSTERS, `${r.tt}.jpg`);
  const poster = fs.existsSync(posterFile) ? `img/${r.tt}.jpg` : (r.poster || null);
  const b = bandOf(agg.avg);
  insert.run(
    r.tt, r.type || 'movie', r.name, r.year || null, poster || null,
    Number(r.popularity) || 0, r.imdb ? Number(r.imdb) : null, r.tmdb ? Number(r.tmdb) : null,
    agg.avg, agg.spread, agg.n, b.label, b.colour, agg.single || null,
    JSON.stringify(Object.fromEntries(KEYS.filter((k) => typeof r[k] === 'number').map((k) => [k, r[k]]))),
    JSON.stringify({ cats: ((r.details || {}).wokealyzer || {}).categories || {}, ai: r.themesAI || null }),
    r.aiSummary || null, r.aiVerdict || null, r.scriptAnalysis ? JSON.stringify(r.scriptAnalysis) : null,
    now,
  );
  ok++;
}
db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('built_at', String(now));
db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('titles', String(ok));
db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('with_summary', String(rows.filter((r) => r.aiSummary).length));
db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('with_script', String(rows.filter((r) => r.scriptAnalysis).length));
console.log(`site.db: ${ok} titles (${rows.filter((r) => r.aiSummary).length} with analysis, ${rows.filter((r) => r.scriptAnalysis).length} with script analysis) -> ${DB}`);
