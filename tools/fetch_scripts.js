'use strict';
// Download the actual screenplay for each title and turn it into text, so the analysis can be written
// from the script instead of a synopsis.
//
//   node tools/fetch_scripts.js data.json [--limit N]
//
// Source: assets.scriptslug.com/live/pdf/scripts/<title-slug>-<year>.pdf (only films; TV is episodic
// and not published this way). Text is extracted with pdftotext. Stored outside the repo in
// data/scripts/<tt>.txt; only short phrases are ever quoted in output, the screenplays are never
// republished.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const LIMIT = Number(argOf('limit', 0)) || 0;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SCRIPTS = path.join(DATA_DIR, 'scripts');
const BASE = 'https://assets.scriptslug.com/live/pdf/scripts';

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byPopularity = (a, b) => (Number(b.popularity) || 0) - (Number(a.popularity) || 0);

function candidates(row) {
  const name = slug(row.name);
  const bare = name.replace(/^the-/, '');
  const year = row.year ? String(row.year).slice(0, 4) : '';
  const list = [];
  if (year) list.push(`${name}-${year}`, `${bare}-${year}`);
  list.push(name, bare);
  return [...new Set(list.filter(Boolean))];
}

async function download(url, destPdf) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/154' } });
  if (!res.ok) return null;
  const type = res.headers.get('content-type') || '';
  if (!type.includes('pdf')) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 20000) return null;
  fs.writeFileSync(destPdf, buf);
  return buf.length;
}

(async () => {
  const rows = JSON.parse(fs.readFileSync(process.argv[2] || 'themes.json', 'utf8'));
  fs.mkdirSync(SCRIPTS, { recursive: true });
  // popular first: a screenplay for a film nobody looks up is wasted effort
  const todo = rows.filter((r) => r.type !== 'series' && !fs.existsSync(path.join(SCRIPTS, `${r.tt}.txt`))).sort(byPopularity);
  const work = LIMIT ? todo.slice(0, LIMIT) : todo;
  console.log(`${rows.length} titles, ${todo.length} without a script text, fetching ${work.length}`);

  let ok = 0;
  let miss = 0;
  for (const row of work) {
    const pdf = path.join(SCRIPTS, `${row.tt}.pdf`);
    const txt = path.join(SCRIPTS, `${row.tt}.txt`);
    let got = null;
    for (const c of candidates(row)) {
      const url = `${BASE}/${c}.pdf`;
      try {
        const size = await download(url, pdf);
        if (size) { got = url; break; }
      } catch (e) { /* next candidate */ }
      await sleep(400);
    }
    if (!got) { miss++; console.log(`  ${row.name}: no script`); continue; }
    try {
      execFileSync('pdftotext', ['-layout', '-nopgbrk', pdf, txt], { stdio: 'ignore', timeout: 60000 });
      const text = fs.readFileSync(txt, 'utf8');
      const words = text.split(/\s+/).filter(Boolean).length;
      if (words < 800) { fs.unlinkSync(txt); miss++; console.log(`  ${row.name}: text too short (${words} words)`); continue; }
      ok++;
      console.log(`  ${row.name}: ${words} words`);
    } catch (e) {
      miss++;
      console.log(`  ${row.name}: extract failed ${e.message.slice(0, 50)}`);
    }
    await sleep(700);
  }
  console.log(`done: ${ok} scripts, ${miss} without`);
})();
