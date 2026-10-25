'use strict';
// Download poster art once and serve it from our own host, so pages do not hotlink TMDB and the grid
// does not wait on a third party.
//
//   node tools/cache_posters.js [--limit N] [--rate 4]
//
// Posters come from the crawl index (image.tmdb.org, w780). Cards only need ~300px, so the size is
// rewritten to w300 before download. Files land in data/posters/<tt>.jpg and are copied into the
// generated site's img/ folder by the build.
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const LIMIT = Number(argOf('limit', 0)) || 0;
const RATE = Math.max(0.5, Number(argOf('rate', 4)) || 4);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const OUT = path.join(DATA_DIR, 'posters');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const small = (u) => String(u || '').replace('/w780/', '/w300/').replace('/w500/', '/w300/').replace('/original/', '/w300/');

(async () => {
  const rows = JSON.parse(fs.readFileSync(process.argv[2] || 'data.json', 'utf8'));
  fs.mkdirSync(OUT, { recursive: true });
  const todo = rows.filter((r) => r.poster && !fs.existsSync(path.join(OUT, `${r.tt}.jpg`)));
  const work = LIMIT ? todo.slice(0, LIMIT) : todo;
  console.log(`${rows.length} titles, ${todo.length} without a cached poster, fetching ${work.length}`);

  let ok = 0;
  let miss = 0;
  for (const [i, row] of work.entries()) {
    const dest = path.join(OUT, `${row.tt}.jpg`);
    try {
      const res = await fetch(small(row.poster), { headers: { 'user-agent': 'Mozilla/5.0 Chrome/154' } });
      if (!res.ok) { miss++; } else {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 3000) { fs.writeFileSync(dest, buf); ok++; } else { miss++; }
      }
    } catch (e) { miss++; }
    if ((i + 1) % 200 === 0) console.log(`  ${i + 1}/${work.length} ok:${ok} miss:${miss}`);
    await sleep(1000 / RATE);
  }
  console.log(`done: ${ok} cached, ${miss} failed`);
})();
