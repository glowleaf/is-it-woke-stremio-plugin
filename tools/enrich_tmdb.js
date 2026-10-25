'use strict';
// Fill in the TMDB id for every title, from Cinemeta. isitwoke.io is keyed by TMDB id, so without it
// its link can only point at the homepage.
//
//   node tools/enrich_tmdb.js [--limit N] [--rate 1.5]
//
// Writes data/woke.db -> tmdb(key TEXT PRIMARY KEY, id INTEGER), resumable.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { fetchBaseMeta } = require('../src/cinemeta');

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const LIMIT = Number(argOf('limit', 0)) || 0;
const RATE = Math.max(0.2, Number(argOf('rate', 1.5)) || 1.5);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const CINEMETA = 'https://v3-cinemeta.strem.io';

const db = new DatabaseSync(path.join(DATA_DIR, 'woke.db'));
db.exec('CREATE TABLE IF NOT EXISTS tmdb (key TEXT PRIMARY KEY, id INTEGER)');
db.exec('CREATE TABLE IF NOT EXISTS meta_ext (key TEXT PRIMARY KEY, popularity REAL, imdb REAL, poster TEXT)');
const mem = { get: () => undefined, set: () => {} };

(async () => {
  const keys = db.prepare("select key, max(source) src from woke_scores where key like 'tt%' group by key").all().map((r) => r.key);
  const have = new Set(db.prepare('select key from tmdb').all().map((r) => r.key));
  const todo = keys.filter((k) => !have.has(k));
  const work = LIMIT ? todo.slice(0, LIMIT) : todo;
  console.log(`${keys.length} titles, ${have.size} with a TMDB id, this run: ${work.length}`);

  const insert = db.prepare('insert or replace into tmdb (key, id) values (?, ?)');
  const insertMeta = db.prepare('insert or replace into meta_ext (key, popularity, imdb, poster) values (?, ?, ?, ?)');
  let ok = 0;
  let miss = 0;
  for (const [i, tt] of work.entries()) {
    let id = null;
    for (const type of ['movie', 'series']) {
      try {
        const base = await fetchBaseMeta(CINEMETA, type, tt, mem);
        if (base && base.moviedb_id) {
          id = Number(base.moviedb_id);
          insertMeta.run(tt, Number(base.popularity) || 0, Number(base.imdbRating) || 0, base.poster || null);
          break;
        }
      } catch (e) { /* try the other type */ }
    }
    if (id) { insert.run(tt, id); ok++; } else miss++;
    if ((i + 1) % 100 === 0) {
      console.log(`${i + 1}/${work.length} ok:${ok} miss:${miss}`);
      fs.writeFileSync(path.join(DATA_DIR, 'tmdb.log.progress'), `${i + 1}/${work.length}\n`);
    }
    await new Promise((r) => setTimeout(r, 1000 / RATE));
  }
  console.log(`done: ok ${ok}, miss ${miss}`);
})();
