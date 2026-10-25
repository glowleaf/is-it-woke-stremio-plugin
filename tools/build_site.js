'use strict';
/**
 * Static site generator. One page per title, built from measured scores plus an AI judgement.
 *
 *   node tools/build_site.js [data.json] [outDir]
 *
 * Record: { tt, type:'movie'|'series'|'game', name, year, tmdb, synopsis,
 *           iiwon, iio, wokeometer, wokealyzer, wokemovie, wokenessratings, virtuevigil,
 *           aiSummary, themesAI:{bossbabes,emasculation},
 *           details:{ iiwon:{factors}, iio:{reasons,verdict}, wokealyzer:{categories,oneLine,explanations} } }
 */
const fs = require('node:fs');
const path = require('node:path');

const NL = String.fromCharCode(10);
const OUT = path.resolve(process.argv[3] || 'site');
const POSTERS = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'posters');
const DATA = path.resolve(process.argv[2] || 'compare.json');
const SITE = 'https://metawokecritic.com';
const BRAND = 'MetaWokeCritic';
const INSTALL = 'https://scrut.greekai.gr/woke/install';

const WEIGHTS = { iiwon: 1, iio: 1, wokeometer: 1, wokealyzer: 2, wokemovie: 1, wokenessratings: 1, virtuevigil: 1 };
const KEYS = Object.keys(WEIGHTS);
const FILM_ONLY = ['movie', 'series'];
const SOURCES = {
  iiwon: {
    label: 'Is It Woke or Not?', kind: 'Human editorial score',
    url: (r) => `https://isitwokeornot.com/search?q=${encodeURIComponent(r.name || r.tt)}`,
  },
  iio: {
    label: 'Is it Woke (isitwoke.io)', kind: 'AI verdict and score',
    url: (r) => (r.tmdb ? `https://isitwoke.io/${r.type === 'series' ? 'tv' : 'movie'}/${r.tmdb}` : `https://isitwoke.io/search?q=${encodeURIComponent(r.name || r.tt)}`),
  },
  wokeometer: { label: 'Wokeometer', kind: 'AI score, 0 to 10', types: ['movie', 'series', 'game'], url: (r) => `https://wokeometer.app/search?q=${encodeURIComponent(r.name || r.tt)}` },
  wokealyzer: {
    label: 'Wokealyzer', kind: 'AI score with a 5-part rubric',
    url: (r) => `https://wokealyzer.com/movie/${r.tt}`,
  },
  wokemovie: {
    label: 'Woke Movie Score', kind: 'AI score plus ten markers',
    url: (r) => `https://wokemoviescore.com/movie/${slugish(r.name)}${r.year ? `-${r.year}` : ''}/`,
  },
  wokenessratings: {
    label: 'Wokeness Ratings', kind: 'scores for wokeness, feminism, chick flick',
    url: (r) => `https://wokenessratings.com/media/${slugish(r.name)}${r.year ? `-${r.year}` : ''}-${r.type === 'series' ? 'series' : 'movie'}`,
  },
  virtuevigil: {
    label: 'Virtue Vigil', kind: 'woke score out of 50',
    url: (r) => `https://virtuevigil.com/reviews/${slugish(r.name)}${r.year ? `-${r.year}` : ''}/`,
  },
};
const BANDS = [
  { max: 19, label: 'Absolute Cinema', colour: '#22c55e' },
  { max: 39, label: 'Very Little Woke', colour: '#84cc16' },
  { max: 59, label: 'Slightly Woke', colour: '#f59e0b' },
  { max: 79, label: 'Very Woke', colour: '#f97316' },
  { max: 100, label: 'Certified Woke', colour: '#ef4444' },
];
const bandOf = (v) => BANDS.find((b) => v <= b.max) || BANDS[BANDS.length - 1];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const smallPoster = (u) => String(u || '').replace('/w780/', '/w300/').replace('/w500/', '/w300/').replace('/original/', '/w300/');
const slugish = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const trim = (s, n) => {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (stop > n * 0.5 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(' '))) + '…';
};

const THEME_LABELS = {
  lgbtq: 'LGBT Themes',
  feminism: 'Feminism',
  identityPolitics: 'Identity Politics',
  oikophobia: 'Anti-Western / Oikophobia',
  antiTheism: 'Anti-Theism',
};
const DERIVED = [
  { label: 'Bossbabes', key: 'bossbabes', re: /boss ?babe|girl ?boss|girlboss|infallible|flawless|inherently perfect|never wrong|always right|outsmarts|superior to (the )?men|effortlessly better|more capable than (the )?(male|men)/i },
  { label: 'Emasculation', key: 'emasculation', re: /emasculat|accessor(?:y|ies)|only find an identity|(?:male|men|husband|father|kens?)[^.]{0,45}(?:incompetent|weak|useless|foolish|bumbling)|(?:incompetent|weak|useless|foolish|bumbling)[^.]{0,45}(?:male|men|husband|father|kens?)|men are (?:portrayed|shown|written|depicted)/i },
];

function aggregate(row) {
  const scored = KEYS.filter((k) => typeof row[k] === 'number').map((k) => ({ k, v: row[k], w: WEIGHTS[k] }));
  if (scored.length < 2) return null;
  const total = scored.reduce((a, s) => a + s.v * s.w, 0);
  const weight = scored.reduce((a, s) => a + s.w, 0);
  const vals = scored.map((s) => s.v).sort((a, b) => a - b);
  return { avg: Math.round(total / weight), spread: vals[vals.length - 1] - vals[0], n: scored.length };
}

// --- blocks -----------------------------------------------------------------------------------

function storyBlock(row) {
  const bits = [];
  if (row.synopsis) bits.push('<h2>The story</h2><p class="synopsis">' + esc(trim(row.synopsis, 430)) + '</p>');
  if (row.aiSummary) {
    bits.push('<h2>What is woke about it</h2><div class="aiwoke">' + esc(row.aiSummary) +
      '<span class="ainote">Our analysis, written from the synopsis and the published scores</span></div>');
  }
  return bits.join('');
}

function verdictLine(row) {
  const agg = aggregate(row);
  if (!agg) return '';
  const band = bandOf(agg.avg);
  const firstSentence = row.aiSummary ? (String(row.aiSummary).match(/^[^.!?]{12,160}[.!?]/) || [''])[0] : '';
  const verdict = row.aiVerdict || firstSentence || ('Scores ' + agg.avg + ' out of 100 on woke score: ' + band.label.toLowerCase() + '.');
  return '<p class="verdict" style="border-color:' + band.colour + '">' + esc(verdict) + '</p>';
}

function bottomLine(row) {
  const agg = aggregate(row);
  if (!agg) return '';
  const band = bandOf(agg.avg);
  const cats = ((row.details || {}).wokealyzer || {}).categories || {};
  const drivers = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([k, v]) => (THEME_LABELS[k] || k) + ' (' + Math.round(v * 10) + ')');
  const ai = row.themesAI || {};
  if (typeof ai.bossbabes === 'number' && ai.bossbabes >= 60) drivers.push('Bossbabes (' + ai.bossbabes + ')');
  if (typeof ai.emasculation === 'number' && ai.emasculation >= 60) drivers.push('Emasculation (' + ai.emasculation + ')');
  return '<h2>Bottom line</h2><p><b>' + agg.avg + '/100, ' + band.label.toLowerCase() + '.</b> ' +
    (drivers.length ? 'Main drivers: ' + drivers.join(', ') + '. ' : '') +
    'Averaged from ' + agg.n + ' scorers, who differ by ' + agg.spread + ' points.</p>';
}


function scriptSection(row) {
  const sa = row.scriptAnalysis;
  if (!sa || !sa.analysis) return '';
  const chips = [];
  if (typeof sa.bossbabes === 'number') chips.push(`<span class="chip"><b>${sa.bossbabes}</b> Bossbabes</span>`);
  if (typeof sa.emasculation === 'number') chips.push(`<span class="chip"><b>${sa.emasculation}</b> Emasculation</span>`);
  const evidence = (sa.evidence || []).length
    ? `<ul class="flags">${sa.evidence.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    : '';
  return `<h2>Script analysis <span class="tag">screenplay</span></h2>` +
    (sa.verdict ? `<p class="verdict" style="border-color:#7b5cff">${esc(sa.verdict)}</p>` : '') +
    `<div class="aiwoke">${esc(sa.analysis)}<span class="ainote">Read from the screenplay itself${sa.scriptWords ? ` (${Number(sa.scriptWords).toLocaleString()} words sampled)` : ''}, not from a synopsis</span></div>` +
    evidence +
    (chips.length ? `<div class="chips" style="margin:0 0 14px">${chips.join(' ')}</div>` : '');
}

function themeTable(row) {
  const wza = (row.details || {}).wokealyzer || {};
  const cats = wza.categories || {};
  const ex = wza.explanations || {};
  const published = Object.entries(cats)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => {
      const pct = Math.round(v * 10);
      const b = bandOf(pct);
      return `<tr><td>${esc(THEME_LABELS[k] || k)}</td><td class="n" style="color:${b.colour}">${pct}</td>` +
        `<td style="width:46%"><div class="bar"><span style="width:${pct}%;background:${b.colour}"></span></div></td>` +
        `<td class="note">Wokealyzer ${v}/10</td></tr>`;
    });

  const texts = [];
  if (wza.oneLine) texts.push({ src: 'Wokealyzer', text: wza.oneLine });
  for (const [k, v] of Object.entries(ex)) {
    if (v && v.length > 20) texts.push({ src: 'Wokealyzer, ' + (THEME_LABELS[k] || k), text: v });
  }
  for (const r of ((row.details || {}).iio || {}).reasons || []) texts.push({ src: 'isitwoke.io', text: r });

  const femPct = typeof cats.feminism === 'number' ? Math.round(cats.feminism * 10) : null;
  const aiThemes = row.themesAI || {};

  const derived = DERIVED.map((theme) => {
    const aiValue = aiThemes[theme.key];
    if (typeof aiValue === 'number') {
      const b = bandOf(aiValue);
      return `<tr><td>${esc(theme.label)} <span class="tag">AI</span></td>` +
        `<td class="n" style="color:${b.colour}">${aiValue}</td>` +
        `<td style="width:46%"><div class="bar"><span style="width:${aiValue}%;background:${b.colour}"></span></div></td>` +
        '<td class="note">judged by AI from the synopsis and the scorers\' notes</td></tr>';
    }
    const hit = texts.find((t) => theme.re.test(t.text));
    const sentence = hit ? String(hit.text).split(/(?<=[.!?])\s+/).find((s) => theme.re.test(s)) || hit.text : null;
    let score = null;
    if (femPct !== null) score = Math.round(femPct * (hit ? 1 : 0.4));
    const colour = score === null ? 'var(--mut)' : bandOf(score).colour;
    const bar = score === null
      ? '<td class="note">no breakdown</td>'
      : `<td style="width:46%"><div class="bar"><span style="width:${score}%;background:${colour}"></span></div></td>`;
    return `<tr><td>${esc(theme.label)} <span class="tag">derived</span></td>` +
      `<td class="n" style="color:${colour}">${score === null ? 'n/a' : score}</td>${bar}` +
      `<td class="note">${hit ? `from ${esc(hit.src)}: “${esc(trim(sentence, 110))}”` : 'no phrase in the notes, half-weighted'}</td></tr>`;
  });

  const body = published.length
    ? published.join(NL) + NL + derived.join(NL)
    : derived.join(NL);

  return `<h2>Theme scores</h2>
<table><thead><tr><th>Theme</th><th>0 to 100</th><th></th><th>Carried by</th></tr></thead><tbody>
${body}
</tbody></table>
<p class="note">The rubric themes are a published breakdown rescaled to 0 to 100. <b>Bossbabes</b> and <b>Emasculation</b> are an AI judgement made from the synopsis and the scorers' own notes, the same way the sites being aggregated make theirs.</p>`;
}

function highlights(row) {
  const d = row.details || {};
  const cards = [];

  const wza = d.wokealyzer || {};
  if (wza.categories && Object.keys(wza.categories).length) {
    const top = Object.entries(wza.categories).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `<span class="chip"><b>${v}/10</b> ${esc(k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()))}</span>`)
      .join(' ');
    cards.push(`<div class="card"><div class="cardhead"><span class="cardname">Wokealyzer <b style="color:${bandOf(row.wokealyzer).colour}">${row.wokealyzer}</b></span><span class="note">rubric</span></div><div class="chips">${top}</div>${wza.oneLine ? `<p class="quote">“${esc(trim(wza.oneLine, 170))}”</p>` : ''}</div>`);
  }

  const iioD = d.iio || {};
  if (iioD.reasons && iioD.reasons.length) {
    cards.push(`<div class="card"><div class="cardhead"><span class="cardname">isitwoke.io <b style="color:${bandOf(row.iio).colour}">${row.iio}</b></span><span class="note">${esc(iioD.verdict || '')}</span></div><ul class="flags">${iioD.reasons.slice(0, 2).map((r) => `<li>${esc(trim(r, 150))}</li>`).join('')}</ul></div>`);
  }

  const ii = d.iiwon || {};
  if (ii.factors && ii.factors.length) {
    const up = ii.factors.filter((f) => f.weight > 0).sort((a, b) => b.weight - a.weight);
    const chips = (up.length ? up : ii.factors).slice(0, 5)
      .map((f) => `<span class="chip${f.weight ? '' : ' zero'}"><b>${f.weight}</b> ${esc(f.label)}</span>`).join(' ');
    cards.push(`<div class="card"><div class="cardhead"><span class="cardname">Is It Woke or Not? <b style="color:${bandOf(row.iiwon).colour}">${row.iiwon}</b></span><span class="note">weighted factors</span></div><div class="chips">${chips}</div></div>`);
  }

  if (!cards.length) return '';
  return `<h2>What each source flagged</h2><div class="cards">${cards.join(NL)}</div>`;
}

function spreadLine(row) {
  const vals = KEYS.filter((k) => typeof row[k] === 'number').map((k) => ({ k, v: row[k] })).sort((a, b) => a.v - b.v);
  if (vals.length < 2) return '';
  const low = vals[0];
  const high = vals[vals.length - 1];
  const spread = high.v - low.v;
  if (spread <= 10) return `<p class="spread">All ${vals.length} sources land within ${spread} points of each other.</p>`;
  return `<p class="spread">Split by ${spread} points: ${SOURCES[high.k].label} highest at ${high.v}, ${SOURCES[low.k].label} lowest at ${low.v}. How the weights were set is on the <a href="../methodology.html">methodology page</a>.</p>`;
}

// --- pages ------------------------------------------------------------------------------------

function head(title, description, canonical, base, showInstall) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title.includes(BRAND) ? title : title + ' | ' + BRAND)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="article">
<style>
:root{--bg:#0b0d10;--card:#14181d;--line:#232a33;--fg:#eef2f6;--mut:#9aa7b4;--accent:#7b5cff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:#a78bfa}
.wrap{max-width:840px;margin:0 auto;padding:26px 18px 60px}
header.site{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:22px;font-size:14px;flex-wrap:wrap}
header.site nav a{margin-right:14px;color:var(--mut);text-decoration:none}
header.site nav a:hover{color:var(--fg)}
h1{font-size:30px;line-height:1.2;margin:0 0 4px}
.meta{color:var(--mut);margin:0 0 18px}
.score{display:flex;align-items:center;gap:18px;padding:20px;border:1px solid var(--line);border-radius:16px;background:var(--card);margin-bottom:20px}
.score .num{font-size:46px;font-weight:800;line-height:1}
.score .band{font-weight:700}
.score .sub{color:var(--mut);font-size:14px}
.synopsis{color:#cfd8e3}
.aiwoke{border-left:3px solid #7b5cff;background:#161a20;padding:12px 16px;border-radius:0 12px 12px 0;margin:0 0 16px;color:#dfe7f0}
.ailabel{display:inline-block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#a78bfa;font-weight:700;margin-right:8px}
.ainote{display:block;margin-top:8px;font-size:12px;color:#7c8896}
table{width:100%;border-collapse:collapse;margin:0 0 18px;font-size:15px}
th,td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
td.n{font-variant-numeric:tabular-nums;font-weight:700}
.bar{height:8px;border-radius:5px;background:#1d232b;overflow:hidden}
.bar span{display:block;height:100%}
.cards{display:grid;gap:12px;margin:0 0 10px}
.card{border:1px solid var(--line);border-radius:14px;background:var(--card);padding:14px 16px}
.cardhead{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:8px}
.cardname{font-weight:700}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{font-size:13px;padding:6px 10px;border-radius:999px;background:#1b2129;border:1px solid #2a323c;color:#cfe0ee}
.chip b{color:#fff}
.chip.zero{opacity:.5}
.tag{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#8b5cf6;border:1px solid #4c1d95;border-radius:6px;padding:1px 5px;vertical-align:middle}
.quote{margin:10px 0 0;color:#cfd8e3;font-style:italic}
.flags{margin:0;padding-left:18px;color:#cfd8e3}
.flags li{margin:0 0 6px}
.verdict{border-left:3px solid;padding:10px 14px;background:#161a20;border-radius:0 12px 12px 0;font-size:17px;margin:0 0 14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:14px;margin:0 0 26px}
.pcard{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;text-decoration:none;color:var(--fg);transition:transform .15s,border-color .15s}
.pcard:hover{transform:translateY(-2px);border-color:#3b4656}
.thumb{position:relative;aspect-ratio:2/3;background:linear-gradient(160deg,#1a2028,#11151a)}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.badge{position:absolute;top:8px;left:8px;background:#000000cc;border-radius:9px;padding:2px 9px;font-weight:800;font-size:19px;line-height:1.3;backdrop-filter:blur(4px)}
.pbody{padding:9px 11px 11px}
.pname{font-size:13px;font-weight:700;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pmeta{font-size:11px;color:var(--mut);margin-top:3px}
.pchips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.pchip{font-size:10px;padding:2px 6px;border-radius:999px;background:#1b2129;color:#b9c6d3}
.hero{display:flex;gap:20px;align-items:flex-start;margin:0 0 20px;flex-wrap:wrap}
.hero .art{width:154px;flex:0 0 auto;border-radius:12px;overflow:hidden;border:1px solid var(--line);background:#151a21}
.hero .art img{width:100%;display:block}
.hero .heroText{flex:1;min-width:250px}
.catbar{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 22px}
.catbar a{font-size:13px;padding:7px 13px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--fg);text-decoration:none}
.catbar a b{color:#a78bfa;margin-left:6px}
.spread{margin:12px 0 0;color:var(--mut);font-size:14px}
h2{font-size:18px;margin:24px 0 8px}
p{margin:0 0 12px}
.cta{display:inline-block;padding:14px 26px;border-radius:12px;background:var(--accent);color:#fff;font-weight:700;text-decoration:none;margin:6px 0 6px}
footer{margin-top:36px;padding-top:16px;border-top:1px solid var(--line);color:var(--mut);font-size:13px}
.note{color:var(--mut);font-size:13px}
</style></head><body><div class="wrap">
<header class="site"><a href="${base}index.html" style="font-weight:800;color:var(--fg);text-decoration:none">${"<span style=\"color:#a78bfa\">Meta</span>WokeCritic"}</a>
<nav><a href="${base}movies.html">Movies</a><a href="${base}series.html">Series</a><a href="${base}games.html">Games</a><a href="${base}methodology.html">Methodology</a>${showInstall === false ? '' : `<a href="${INSTALL}">Install in Stremio</a>`}</nav></header>
`;
}

const foot = (base) => `<footer><p>Aggregated from published scorers; the theme analysis, the summary and the two derived indices are ours. <a href="${base}methodology.html">Methodology</a>.</p></footer></div></body></html>`;

function titlePage(row) {
  const agg = aggregate(row);
  const band = agg ? bandOf(agg.avg) : null;
  const canon = `${SITE}/t/${row.tt}.html`;
  const desc = agg
    ? `${row.name} (${row.year}) scores ${agg.avg} out of 100 on woke score, from ${agg.n} sources with a ${agg.spread} point spread.`
    : `${row.name} (${row.year}) woke score across the sources that have reviewed it.`;

  const onlyKey = KEYS.find((k) => typeof row[k] === 'number');
  const onlyBand = onlyKey ? bandOf(row[onlyKey]) : null;
  const scoreBlock = agg
    ? `<div class="score"><div class="num" style="color:${band.colour}">${agg.avg}</div><div><div class="band" style="color:${band.colour}">${band.label}</div><div class="sub">weighted average of ${agg.n} sources, ${agg.spread} point spread</div></div></div>`
    : onlyKey
      ? `<div class="score"><div class="num" style="color:${onlyBand.colour}">${row[onlyKey]}</div><div><div class="band" style="color:${onlyBand.colour}">${onlyBand.label}</div><div class="sub">scored by <a href="${SOURCES[onlyKey].url(row)}" rel="nofollow noopener" target="_blank">${esc(SOURCES[onlyKey].label)}</a></div></div></div>`
      : '<div class="score"><div class="num" style="color:var(--mut)">n/a</div><div><div class="band" style="color:var(--mut)">No scores yet</div><div class="sub">Nothing has scored this title.</div></div></div>';

  const medium = row.type || 'movie';
  const applicable = KEYS.filter((k) => (SOURCES[k].types || FILM_ONLY).includes(medium));
  const rows = applicable.map((k) => {
    const v = row[k];
    const s = SOURCES[k];
    if (typeof v !== 'number') {
      return `<tr><td>${esc(s.label)}<div class="note">${esc(s.kind)}</div></td><td class="n" colspan="3" style="color:var(--mut)">not scored</td></tr>`;
    }
    const b = bandOf(v);
    return `<tr><td><a href="${s.url(row)}" rel="nofollow noopener" target="_blank">${esc(s.label)}</a><div class="note">${esc(s.kind)}</div></td>` +
      `<td class="n" style="color:${b.colour}">${v}</td>` +
      `<td style="width:40%"><div class="bar"><span style="width:${v}%;background:${b.colour}"></span></div></td>` +
      `<td class="n" style="color:${b.colour};font-weight:600">${esc(b.label)}</td></tr>`;
  }).join(NL);

  const isGame = row.type === 'game';
  return head(`${row.name}${row.year ? ` (${row.year})` : ''} woke score`, desc, canon, '../', !isGame) + `
<article>
<h1>${esc(row.name)}${row.year ? ` (${row.year})` : ''} woke score</h1>
<p class="meta">${row.type === 'series' ? 'TV series' : row.type === 'game' ? 'Game' : 'Film'}</p>
<div class="hero">${(() => { const lp = path.join(OUT, 'img', row.tt + '.jpg'); const src = fs.existsSync(lp) ? '../img/' + row.tt + '.jpg' : smallPoster(row.poster); return src ? '<div class="art"><img src="' + esc(src) + '" alt="' + esc(row.name) + ' poster"></div>' : ''; })()}<div class="heroText">${verdictLine(row)}${scoreBlock}</div></div>
${isGame ? '' : `<p><a class="cta" href="${INSTALL}">Get this on every title in Stremio</a></p>`}
${storyBlock(row)}
${scriptSection(row)}
${themeTable(row)}
${bottomLine(row)}
${highlights(row)}
<h2>Where the number comes from</h2>
<p class="note">Each score below is published by that site. The weighting, the theme analysis and the summary are ours.</p>
<table><thead><tr><th>Source</th><th>Score</th><th></th><th>Band</th></tr></thead><tbody>
${rows}
</tbody></table>
${spreadLine(row)}
${isGame ? '' : `<h2>See it inside Stremio</h2>
<p>The aggregate, each source and these theme scores on the movie or series page: chips on desktop, the first line of the description on phones and TVs, and an entry at the top of the sources list.</p>
<a class="cta" href="${INSTALL}">Install the Stremio addon</a>
<p class="note">Free, no account, nothing to configure.</p>`}
</article>
${foot('../')}`;
}

function cardHTML(row, base) {
  const score = bestScore(row);
  const band = score >= 0 ? bandOf(score) : null;
  const local = path.join(OUT, 'img', row.tt + '.jpg');
  const src = fs.existsSync(local) ? base + 'img/' + row.tt + '.jpg' : smallPoster(row.poster);
  const cats = Object.entries(((row.details || {}).wokealyzer || {}).categories || {})
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => '<span class="pchip">' + esc(String(THEME_LABELS[k] || k).split(' /')[0]) + ' ' + v + '/10</span>').join('');
  return '<a class="pcard" href="' + base + 't/' + row.tt + '.html">' +
    '<div class="thumb">' + (src ? '<img src="' + esc(src) + '" loading="lazy" alt="' + esc(row.name) + '">' : '') +
    (band ? '<span class="badge" style="color:' + band.colour + '">' + score + '</span>' : '') + '</div>' +
    '<div class="pbody"><div class="pname">' + esc(row.name) + '</div>' +
    '<div class="pmeta">' + (row.year ? row.year + ' · ' : '') + (band ? esc(band.label) : 'unscored') + '</div>' +
    (cats ? '<div class="pchips">' + cats + '</div>' : '') + '</div></a>';
}

function gridHTML(rows, base) {
  const sorted = rows.map((r) => ({ r, s: bestScore(r) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s);
  if (!sorted.length) return '';
  return '<div class="grid">' + sorted.map((x) => cardHTML(x.r, base)).join('') + '</div>';
}

const bestScore = (r) => { const a = aggregate(r); if (a) return a.avg; const k = KEYS.find((x) => typeof r[x] === 'number'); return k ? r[k] : -1; };

function table(rows) {
  const scored = rows.filter((r) => bestScore(r) >= 0).map((r) => ({ r, a: aggregate(r), s: bestScore(r) }));
  scored.sort((x, y) => y.s - x.s);
  if (!scored.length) return '';
  const body = scored.map(({ r, a, s }) => {
    const b = bandOf(s);
    return `<tr><td><a href="t/${r.tt}.html">${esc(r.name)}</a> <span class="note">${r.year || ''}</span></td>` +
      `<td class="n" style="color:${b.colour}">${s}</td>` +
      `<td class="note">${a ? a.spread : '—'}</td><td class="note">${a ? a.n : 1}</td></tr>`;
  }).join(NL);
  return `<table><thead><tr><th>Title</th><th>Aggregate</th><th>Spread</th><th>Sources</th></tr></thead><tbody>${body}</tbody></table>`;
}

function categoryPage(rows, type, heading, blurb) {
  const list = rows.filter((r) => (r.type || 'movie') === type);
  const scored = list.filter((r) => bestScore(r) >= 0);
  const url = `${SITE}/${type === 'series' ? 'series' : type === 'game' ? 'games' : 'movies'}.html`;
  const isGame = type === 'game';
  const content = scored.length
    ? gridHTML(list, '')
    : `<p class="note">Nothing scored here yet. ${esc(blurb)}</p>`;
  return head(`${heading} ranked by woke score`, `${heading}: ${scored.length} titles with an aggregated woke score, highest first.`, url, '', !isGame) + `
<h1>${esc(heading)}</h1>
<p class="meta">${esc(blurb)} ${scored.length} scored.</p>
${isGame ? '' : `<a class="cta" href="${INSTALL}">Install in Stremio</a>`}
<h2>Highest to lowest</h2>
${content}
${foot('')}`;
}

function indexPage(rows) {
  const counts = {
    movie: rows.filter((r) => (r.type || 'movie') === 'movie' && bestScore(r) >= 0).length,
    series: rows.filter((r) => r.type === 'series' && bestScore(r) >= 0).length,
    game: rows.filter((r) => r.type === 'game' && bestScore(r) >= 0).length,
  };
  return head('MetaWokeCritic: aggregated woke scores for films, TV and games',
    'Woke scores from independent scorers combined into one number per title, plus a theme breakdown and an AI summary of what the scorers flagged.',
    SITE + '/index.html', '') + `
<h1><span style="color:#a78bfa">Meta</span>WokeCritic</h1>
<p class="meta">One number per title, from scorers that work independently, with the spread and the theme breakdown kept visible instead of averaged away.</p>
<a class="cta" href="${INSTALL}">Install in Stremio</a>
<div class="catbar"><a href="movies.html">Movies<b>${counts.movie}</b></a><a href="series.html">Series<b>${counts.series}</b></a><a href="games.html">Games<b>${counts.game}</b></a></div>
<h2>Highest scores</h2>
${gridHTML(rows.slice().sort((a, b) => bestScore(b) - bestScore(a)).slice(0, 24), '')}
<p class="note">A large spread means the scorers disagree; each title page shows what each one flagged and why the weighting leans where it does. <a href="methodology.html">Methodology</a>.</p>
${foot('')}`;
}

function methodologyPage() {
  return head('Methodology: how the woke score aggregate is built',
    'Each source is normalised to 0 to 100, weighted, and shown with its spread, theme breakdown and an AI summary.', SITE + '/methodology.html', '') + `
<h1>Methodology</h1>
<p>Independent scorers disagree, sometimes by 60 points on the same film. This index keeps every score visible, adds one weighted average, and writes the analysis the individual scorers do not: what the themes are, in one place.</p>
<h2>Normalisation</h2>
<p>Sources publishing 0 to 10 are multiplied by ten; Woke Movie Score publishes 0 to 100; Virtue Vigil publishes out of 50 and is doubled. Nothing else is changed, no curve fitting, no rescaling to force agreement.</p>
<h2>Theme scores</h2>
<p>Five themes come from a published rubric (Identity Politics, Oikophobia, Feminism, LGBTQ+, Anti-Theism) rescaled to 0 to 100. Bossbabes and Emasculation are judged by AI from the synopsis and the scorers' own notes, because no source publishes those two as fields and titles without a rubric page would otherwise have nothing to show. The judgement is stated as ours, not attributed to a source.</p>
<h2>Weights</h2>
<p>Across 22 films and series every scorer was compared with the others. Is It Woke or Not? is the only human editorial source, so it is the reference for "does this match a person's judgement".</p>
<table><thead><tr><th>Pair</th><th>Titles</th><th>Avg gap</th><th>Rank correlation</th></tr></thead><tbody>
<tr><td>Wokealyzer vs Is It Woke or Not?</td><td class="n">11</td><td class="n">10.7</td><td class="n">0.90</td></tr>
<tr><td>Wokeometer vs Is It Woke or Not?</td><td class="n">11</td><td class="n">15.9</td><td class="n">0.66</td></tr>
<tr><td>isitwoke.io vs Is It Woke or Not?</td><td class="n">11</td><td class="n">19.0</td><td class="n">0.27</td></tr>
<tr><td>isitwoke.io vs Wokeometer</td><td class="n">22</td><td class="n">7.2</td><td class="n">0.67</td></tr>
</tbody></table>
<p>Wokealyzer reproduces the human ranking most closely, so it counts double. It also runs hotter than the other automated scorers, which is why it does not count more than double.</p>
${foot('')}`;
}

function main() {
  const rows = JSON.parse(fs.readFileSync(DATA, 'utf8')).filter((r) => r && r.tt && r.name);
  fs.mkdirSync(path.join(OUT, 't'), { recursive: true });
  // cached posters are served from our own host; the build only links the ones that exist
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  let posters = 0;
  try {
    for (const f of fs.readdirSync(POSTERS)) {
      if (!f.endsWith('.jpg')) continue;
      fs.copyFileSync(path.join(POSTERS, f), path.join(OUT, 'img', f));
      posters++;
    }
  } catch (e) { /* no cache yet */ }
  for (const r of rows) fs.writeFileSync(path.join(OUT, 't', `${r.tt}.html`), titlePage(r));
  fs.writeFileSync(path.join(OUT, 'index.html'), indexPage(rows));
  fs.writeFileSync(path.join(OUT, 'movies.html'), categoryPage(rows, 'movie', 'Movies', 'Films with at least two published scores.'));
  fs.writeFileSync(path.join(OUT, 'series.html'), categoryPage(rows, 'series', 'Series', 'TV shows with at least two published scores.'));
  fs.writeFileSync(path.join(OUT, 'games.html'), categoryPage(rows, 'game', 'Games', 'No scorer in this index publishes game scores yet, so nothing is listed rather than guessed.'));
  fs.writeFileSync(path.join(OUT, 'methodology.html'), methodologyPage());
  const urls = ['/index.html', '/movies.html', '/series.html', '/games.html', '/methodology.html', ...rows.map((r) => `/t/${r.tt}.html`)];
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>' + NL + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + NL +
    urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join(NL) + NL + '</urlset>' + NL);
  fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *${NL}Allow: /${NL}Sitemap: ${SITE}/sitemap.xml${NL}`);
  console.log(`posters: ${posters} | generated ${rows.length} title pages + index, movies, series, games, methodology, sitemap in ${OUT}`);
}

main();
