'use strict';
// Writes the analysis the page shows: a verdict, a paragraph on what is actually woke about the
// title, and the two AI theme scores. Output format is four labelled lines, not JSON, because models
// put raw newlines inside JSON strings and every parse attempt eventually fails on one.
//
//   node tools/ai_summary.js data.json [--limit N] [--workers 4]
const fs = require('node:fs');
const path = require('node:path');
const { fetchBaseMeta } = require('../src/cinemeta');

const mem = { get: () => undefined, set: () => {} };
const CINEMETA = 'https://v3-cinemeta.strem.io';
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const LIMIT = Number(argOf('limit', 0)) || 0;
const STORE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'ai-summary');
const WORKERS = Math.max(1, Math.min(6, Number(argOf('workers', 4)) || 4));

function loadKey() {
  if (process.env.DEEPSEEK_API_KEY) return { key: process.env.DEEPSEEK_API_KEY, base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' };
  const candidates = [
    path.join(process.env.HERMES_HOME || path.join(process.env.LOCALAPPDATA || '', 'hermes'), '.env'),
    path.join(process.env.HOME || '', '.hermes', '.env'),
    path.join(process.env.HOME || '', '.env'),
  ];
  let txt = '';
  for (const p of candidates) { try { txt += fs.readFileSync(p, 'utf8'); } catch (e) { /* next */ } }
  const grab = (k) => (txt.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1];
  const ds = grab('DEEPSEEK_API_KEY');
  if (ds) return { key: ds.trim().replace(/^["']|["']$/g, ''), base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' };
  const oc = grab('OPENCODE_ZEN_API_KEY') || grab('OPENCODE_GO_API_KEY');
  if (oc) return { key: oc.trim().replace(/^["']|["']$/g, ''), base: 'https://opencode.ai/zen/go/v1', model: 'deepseek-v4.1-flash' };
  return null;
}

const cfg = loadKey();
if (!cfg) {
  console.error('no LLM key found');
  process.exit(1);
}

const SYSTEM = [
  'You write the single page someone lands on when deciding whether to watch a film or show.',
  'Answer in exactly four lines, no other text:',
  'VERDICT: one sentence under 18 words answering whether it is woke and what drives that.',
  'SUMMARY: 70 to 90 words of specific analysis.',
  'BOSSBABES: a number 0 to 100.',
  'EMASCULATION: a number 0 to 100.',
  'Write as the publication itself, never as a report of other sites: no "scorers flagged", no "sources note".',
  'Name concrete things: characters, casting, plot choices, dialogue, symbols, the ending.',
  'BOSSBABES means the female lead is written as flawless, always right and more competent than every man, her competence being the point of the character.',
  'EMASCULATION means male characters are written as weak, foolish, ornamental or needing rescue.',
  'Score what the work shows, not its genre or audience. A competent female lead among capable men scores low on both.',
  'Never invent plot details. No moralising, no emoji, no markdown.',
  'If a screenplay excerpt is supplied, judge from the actual scenes and dialogue in it, not from the synopsis.',
].join(' ');

async function complete(prompt) {
  const res = await fetch(`${cfg.base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.4,
      max_tokens: 260,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  return (data.choices && data.choices[0] && data.choices[0].message.content) || '';
}

function scriptExcerpt(tt) {
  const p = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'scripts', `${tt}.txt`);
  try {
    const t = fs.readFileSync(p, 'utf8').replace(/\s+/g, ' ').trim();
    if (t.length < 4000) return t || null;
    const third = Math.floor(t.length / 3);
    return t.slice(0, 2600) + ' […] ' + t.slice(third - 1100, third + 1500) + ' […] ' + t.slice(-2600);
  } catch (e) {
    return null;
  }
}

function buildPrompt(row, synopsis, notes, script) {
  const cats = (((row.details || {}).wokealyzer || {}).categories) || {};
  const themes = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}/10`).join(', ');
  return [
    `Title: ${row.name}${row.year ? ` (${row.year})` : ''}${row.type === 'series' ? ', TV series' : ''}`,
    synopsis ? `Synopsis: ${synopsis}` : '',
    script ? `Screenplay excerpt (the real script; […] marks omitted pages):\n${script}` : '',
    themes ? `Published theme scores: ${themes}` : '',
    notes.length ? `Site notes:\n- ${notes.join('\n- ')}` : '',
    '',
    'Answer with the four labelled lines.',
  ].filter(Boolean).join('\n');
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^["'“”]+|["'“”]+$/g, '').trim();

function field(raw, label) {
  const lines = String(raw).split('\n');
  for (const line of lines) {
    const m = line.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'i'));
    if (m) return m[1].trim();
  }
  return null;
}

async function one(row) {
  let synopsis = row.synopsis || '';
  if (!synopsis) {
    try {
      const base = await fetchBaseMeta(CINEMETA, row.type === 'series' ? 'series' : 'movie', row.tt, mem);
      if (base && base.description) { synopsis = String(base.description).replace(/\s+/g, ' ').trim(); row.synopsis = synopsis; }
    } catch (e) { /* keep going without it */ }
  }
  if (!synopsis) { row.aiSummarySkipped = 'no synopsis'; return row; }

  const d = row.details || {};
  const notes = [];
  const wza = d.wokealyzer || {};
  for (const [, v] of Object.entries(wza.explanations || {})) {
    if (v && v.length > 40) {
      const s = String(v).split(/(?<=[.!?])\s+/)[0];
      if (s) notes.push(s.slice(0, 190));
    }
  }
  if (wza.oneLine) notes.push(wza.oneLine);
  for (const r of (d.iio && d.iio.reasons) || []) notes.push(String(r).slice(0, 190));

  try {
    const raw = await complete(buildPrompt(row, synopsis, notes.slice(0, 4), scriptExcerpt(row.tt)));
    const verdict = field(raw, 'VERDICT');
    const summary = field(raw, 'SUMMARY');
    const boss = field(raw, 'BOSSBABES');
    const emas = field(raw, 'EMASCULATION');
    if (summary) {
      row.aiSummary = clean(summary);
      if (verdict) row.aiVerdict = clean(verdict);
      const b = boss ? Math.max(0, Math.min(100, Math.round(Number(boss.replace(/[^0-9.]/g, '')) || 0))) : null;
      const e = emas ? Math.max(0, Math.min(100, Math.round(Number(emas.replace(/[^0-9.]/g, '')) || 0))) : null;
      if (b !== null) row.themesAI = { ...(row.themesAI || {}), bossbabes: b };
      if (e !== null) row.themesAI = { ...(row.themesAI || {}), emasculation: e };
    } else {
      row.aiSummaryError = 'unparsed answer';
    }
  } catch (e) {
    row.aiSummaryError = e.message.slice(0, 80);
  }
  if (row.aiSummary) {
    try {
      fs.mkdirSync(STORE, { recursive: true });
      fs.writeFileSync(path.join(STORE, row.tt + '.json'), JSON.stringify({
        tt: row.tt, name: row.name, year: row.year || null,
        summary: row.aiSummary, verdict: row.aiVerdict || null,
        themesAI: row.themesAI || null, synopsis: row.synopsis || null,
        model: cfg.model, at: new Date().toISOString(),
      }, null, 1));
    } catch (e) { /* the page just misses its summary this run */ }
  }
  return row;
}

(async () => {
  const file = process.argv[2] || 'themes.json';
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const todo = rows.filter((r) => !r.aiSummary);
  const work = LIMIT ? todo.slice(0, LIMIT) : todo;
  console.log(`${file}: ${rows.length} rows, ${todo.length} without analysis, doing ${work.length} with ${WORKERS} workers (${cfg.model})`);

  const queue = work.slice();
  let done = 0;
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (queue.length) {
      const row = queue.shift();
      await one(row);
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${work.length} ${row.name} -> ${(row.aiVerdict || row.aiSummaryError || '').slice(0, 70)}`);
    }
  }));

  fs.writeFileSync(file, JSON.stringify(rows, null, 1));
  console.log(`written: ${file} (${rows.filter((r) => r.aiSummary).length} with analysis)`);
})();
