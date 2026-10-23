'use strict';
// Fill theme-level data for every title already in the score cache.
//
//   node tools/collect_wokealyzer_categories.js [--limit N] [--rate 1]
//
// For each scored title this fetches the wokealyzer page (type-agnostic: it serves both films and
// series under /movie/<tt>), extracts the 5 rubric categories, the one-line verdict and the
// per-category justification text, and stores them in data/woke.db -> woke_themes.
// Resumable: existing rows are skipped, so re-running only fills gaps.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { getText } = require('../src/http');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const LIMIT = Number(argOf('limit', 0)) || 0;
const RATE = Math.max(0.2, Number(argOf('rate', 1)) || 1);

const db = new DatabaseSync(path.join(DATA_DIR, 'woke.db'));
db.exec('CREATE TABLE IF NOT EXISTS woke_themes (key TEXT PRIMARY KEY, payload TEXT, fetched_at INTEGER)');

const keys = db
  .prepare("select key, count(distinct source) c from woke_scores where score is not null and key like 'tt%' group by key having c >= 2 order by c desc")
  .all()
  .map((r) => r.key);
const done = new Set(db.prepare('select key from woke_themes').all().map((r) => r.key));
const todo = keys.filter((k) => !done.has(k));
const work = LIMIT ? todo.slice(0, LIMIT) : todo;
console.log(`titles scored: ${keys.length}, already have themes: ${done.size}, this run: ${work.length}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOne(tt) {
  const html = await Promise.race([
    getText(`https://www.wokealyzer.com/movie/${tt}`),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000)),
  ]);
  const unesc = html.split('\\"').join('"');
  const m = unesc.match(/"overallScore":([\d.]+)[\s\S]{0,4000}?"scores":\{([^}]*)\}/);
  const one = html.match(/oneLineReview\\":\\"(.{10,220}?)\\"/);
  const cats = m ? Object.fromEntries([...m[2].matchAll(/"(\w+)":([\d.]+)/g)].map((x) => [x[1], Number(x[2])])) : null;
  const ex = unesc.match(/"explanations":\{"identityPolitics":"([\s\S]*?)","oikophobia":"([\s\S]*?)","feminism":"([\s\S]*?)","lgbtq":"([\s\S]*?)","antiTheism":"([\s\S]*?)"\}/);
  const explanations = ex ? { identityPolitics: ex[1], oikophobia: ex[2], feminism: ex[3], lgbtq: ex[4], antiTheism: ex[5] } : null;
  if (!cats || !Object.keys(cats).length) return null;
  return { wokealyzer: { categories: cats, oneLine: one ? one[1] : null, explanations } };
}

(async () => {
  const insert = db.prepare('insert or replace into woke_themes (key, payload, fetched_at) values (?, ?, ?)');
  let ok = 0;
  let miss = 0;
  for (const [i, tt] of work.entries()) {
    try {
      const payload = await fetchOne(tt);
      if (payload) { insert.run(tt, JSON.stringify(payload), Date.now()); ok++; }
      else miss++;
    } catch (e) {
      miss++;
    }
    if ((i + 1) % 50 === 0 || i === work.length - 1) {
      console.log(`${i + 1}/${work.length} ok:${ok} missing:${miss}`);
      fs.writeFileSync(path.join(DATA_DIR, 'themes.log.progress'), `${i + 1}/${work.length} ok=${ok}\n`);
    }
    await sleep(1000 / RATE);
  }
  console.log(`done. with themes: ${ok}, without: ${miss}`);
})();
