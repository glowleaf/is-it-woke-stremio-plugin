'use strict';
// Deep analysis from the actual screenplay, kept separate from the synopsis-based summary.
//
//   node tools/script_analysis.js data.json [--limit N] [--workers 3] [--tt tt1517268]
//
// Writes one JSON per title into data/script-analysis/<tt>.json so the site build can pick them up and
// the batch is resumable: an existing file is skipped unless --force.
//
// The screenplay is sampled, not sent whole: five evenly spaced slices plus the ending. That keeps a
// run to a few thousand tokens per title while still covering the opening, the middle and the payoff,
// which is where the ideology in a film actually shows.
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const LIMIT = Number(argOf('limit', 0)) || 0;
const WORKERS = Math.max(1, Math.min(6, Number(argOf('workers', 3)) || 3));
const ONLY = argOf('tt', null);
const FORCE = args.includes('--force');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SCRIPTS = path.join(DATA_DIR, 'scripts');
const OUT = path.join(DATA_DIR, 'script-analysis');

function loadKey() {
  if (process.env.DEEPSEEK_API_KEY) return { key: process.env.DEEPSEEK_API_KEY, base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' };
  const cands = [
    path.join(process.env.HERMES_HOME || path.join(process.env.LOCALAPPDATA || '', 'hermes'), '.env'),
    path.join(process.env.HOME || '', '.hermes', '.env'),
    path.join(process.env.HOME || '', '.env'),
  ];
  let txt = '';
  for (const p of cands) { try { txt += fs.readFileSync(p, 'utf8'); } catch (e) { /* next */ } }
  const grab = (k) => (txt.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1];
  const ds = grab('DEEPSEEK_API_KEY');
  if (ds) return { key: ds.trim().replace(/^["']|["']$/g, ''), base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' };
  return null;
}

const cfg = loadKey();
if (!cfg) { console.error('no LLM key'); process.exit(1); }

const SYSTEM = [
  'You analyse screenplays for ideological content: casting and representation, gender dynamics, identity politics,',
  'treatment of religion, capitalism, the military, family, and who the villain is.',
  'Answer in exactly five labelled lines, nothing else:',
  'VERDICT: one sentence, under 20 words, saying whether the script is woke and what drives it.',
  'ANALYSIS: 110 to 160 words on what the script actually does, naming scenes, characters and beats.',
  'EVIDENCE: three short quotes or moments from the script, separated by " | ".',
  'BOSSBABES: 0 to 100. Female lead written as flawless, always right, more competent than every man, that being the point.',
  'EMASCULATION: 0 to 100. Male characters written as weak, foolish, ornamental or needing rescue.',
  'Judge only from the supplied pages. Never invent scenes. No markdown, no emoji.',
].join(' ');

function sample(tt) {
  const p = path.join(SCRIPTS, `${tt}.txt`);
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const words = clean.split(/\s+/).filter(Boolean).length;
  if (words < 1200) return null;
  const slices = 5;
  const size = 1500;
  const out = [];
  for (let i = 0; i < slices; i++) {
    const start = Math.floor((clean.length * i) / slices);
    out.push(clean.slice(start, start + size));
  }
  out.push(clean.slice(-1800));
  return { excerpt: out.join('\n\n[...]\n\n'), words };
}

async function complete(prompt) {
  const res = await fetch(`${cfg.base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.3,
      max_tokens: 520,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  return (data.choices && data.choices[0] && data.choices[0].message.content) || '';
}

const field = (raw, label) => {
  for (const line of String(raw).split('\n')) {
    const m = line.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'i'));
    if (m) return m[1].trim();
  }
  return null;
};
const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^["'“”]+|["'“”]+$/g, '').trim();

// Quotes lifted out of a model answer often have one straggler at one end. Strip those, and drop a
// lone unmatched quote entirely so a bullet never reads as broken markup.
function fixQuote(s) {
  let t = String(s || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^[\s"“”'“”‘’]+|[\s"“”'“”‘’]+$/g, '');
  if (!t) return null;
  const quotes = (t.match(/"/g) || []).length;
  if (quotes % 2 === 1) t = t.replace(/"/, '');
  return t.replace(/\s+/g, ' ').trim();
}

async function analyse(row) {
  const dest = path.join(OUT, `${row.tt}.json`);
  if (fs.existsSync(dest) && !FORCE) return 'skip';
  const s = sample(row.tt);
  if (!s) return 'no-script';
  const prompt = [
    `Title: ${row.name}${row.year ? ` (${row.year})` : ''}`,
    `Screenplay pages sampled from a ${s.words} word script:`,
    s.excerpt,
    '',
    'Answer with the five labelled lines.',
  ].join('\n');
  const raw = await complete(prompt);
  const verdict = field(raw, 'VERDICT');
  const analysis = field(raw, 'ANALYSIS');
  const evidence = field(raw, 'EVIDENCE');
  const boss = field(raw, 'BOSSBABES');
  const emas = field(raw, 'EMASCULATION');
  if (!analysis) return 'unparsed';
  const num = (v) => (v ? Math.max(0, Math.min(100, Math.round(Number(String(v).replace(/[^0-9.]/g, '')) || 0))) : null);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(dest, JSON.stringify({
    tt: row.tt,
    name: row.name,
    year: row.year || null,
    verdict: clean(verdict),
    analysis: clean(analysis),
    evidence: evidence ? evidence.split('|').map(fixQuote).filter(Boolean).slice(0, 3) : [],
    bossbabes: num(boss),
    emasculation: num(emas),
    scriptWords: s.words,
    model: cfg.model,
    at: new Date().toISOString(),
  }, null, 1));
  return 'ok';
}

(async () => {
  const rows = JSON.parse(fs.readFileSync(process.argv[2] || 'themes.json', 'utf8'));
  fs.mkdirSync(OUT, { recursive: true });
  const pool = (ONLY ? rows.filter((r) => r.tt === ONLY) : rows.slice().sort(byPopularity)).filter((r) => r.type !== 'game');
  const todo = pool.filter((r) => fs.existsSync(path.join(SCRIPTS, `${r.tt}.txt`)) && (FORCE || !fs.existsSync(path.join(OUT, `${r.tt}.json`))));
  const work = LIMIT ? todo.slice(0, LIMIT) : todo;
  console.log(`${pool.length} titles, ${todo.length} with a script and no analysis yet, doing ${work.length} (${cfg.model})`);

  const queue = work.slice();
  const counts = { ok: 0, 'no-script': 0, unparsed: 0, skip: 0, err: 0 };
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (queue.length) {
      const row = queue.shift();
      try {
        const r = await analyse(row);
        counts[r] = (counts[r] || 0) + 1;
        console.log(`  ${r.padEnd(9)} ${row.name}`);
      } catch (e) {
        counts.err++;
        console.log(`  err       ${row.name}: ${e.message.slice(0, 60)}`);
      }
    }
  }));
  console.log('done:', JSON.stringify(counts));
})();
