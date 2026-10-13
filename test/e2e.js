'use strict';
// End-to-end test: boots the real addon server on a random port and requests it the way
// Stremio does, so the manifest, the config-in-URL decoding, the 4.5s deadline and BOTH
// rating sources are all exercised. Run: node test/e2e.js

const { server, manifest } = require('../src/server');
const { encodeConfig, DEFAULTS } = require('../src/config');
const { parseVerdict } = require('../src/isitwokeio');

function fail(msg) {
  console.log(`FAIL ${msg}`);
  process.exitCode = 1;
}

// Offline unit check of the flight-payload parser, with the escaping the site actually uses.
function testParser() {
  const sample = 'x\\"title\\":\\"Barbie\\",\\"wokeScore\\":82,\\"verdictLabel\\":\\"Certified Woke Trash\\",\\"shortReasons\\":[\\"one\\",\\"two\\"]y';
  const parsed = parseVerdict(sample);
  if (!parsed) return fail('parseVerdict: no match');
  if (parsed.score !== 82) return fail(`parseVerdict score=${parsed.score}`);
  if (parsed.verdictLabel !== 'Certified Woke Trash') return fail(`parseVerdict label=${parsed.verdictLabel}`);
  if (parsed.reasons.length !== 2) return fail(`parseVerdict reasons=${parsed.reasons.length}`);
  if (!parsed.band || parsed.band.step !== 4) return fail(`parseVerdict band=${JSON.stringify(parsed.band)}`);
  console.log('ok parseVerdict');
}

(async () => {
  testParser();

  const cfg = encodeConfig(DEFAULTS);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}${process.env.BASE_PATH || ''}`;
  console.log(`server on ${base}`);

  const mf = await (await fetch(`${base}/${cfg}/manifest.json`)).json();
  if (mf.id !== manifest(DEFAULTS).id) fail(`manifest id ${mf.id}`);
  if (!mf.resources.some((r) => r.name === 'meta')) fail('manifest has no meta resource');
  console.log(`ok manifest: ${mf.name} v${mf.version}, resources=${mf.resources.map((r) => r.name).join(',')}, catalogs=${mf.catalogs.length}`);

  const bad = await fetch(`${base}/not-base64/json/manifest.json`);
  if (bad.status !== 400) fail(`bad config should be 400, got ${bad.status}`);
  console.log('ok invalid config rejected');

  const CASES = [
    { id: 'tt1160419', type: 'movie', label: 'Dune (2021)' },
    { id: 'tt0944947', type: 'series', label: 'Game of Thrones (isitwoke.io only)' },
    { id: 'tt1517268', type: 'movie', label: 'Barbie (2023)' },
    { id: 'tt0133093', type: 'movie', label: 'The Matrix (1999, unreviewed)' },
  ];

  for (const c of CASES) {
    const t0 = Date.now();
    const res = await fetch(`${base}/${cfg}/meta/${c.type}/${c.id}.json`);
    const body = await res.json();
    const ms = Date.now() - t0;
    if (res.status !== 200 || !body.meta) {
      fail(`${c.label}: status ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
      continue;
    }
    const rows = {};
    for (const l of body.meta.links || []) (rows[l.category] = rows[l.category] || []).push(l.name);
    const names = Object.keys(rows).filter((k) => k === DEFAULTS.titleA || k === DEFAULTS.titleB || k === DEFAULTS.combinedTitle);
    console.log(`\n${c.label} [${c.id}] ${ms}ms  cache=${res.headers.get('cache-control')}`);
    console.log(`   meta kept: name=${body.meta.name} poster=${body.meta.poster ? 'yes' : 'NO'} background=${body.meta.background ? 'yes' : 'NO'} videos=${Array.isArray(body.meta.videos) ? body.meta.videos.length : 0}`);
    for (const [cat, list] of Object.entries(rows)) console.log(`   ${cat} -> ${list.join('  ')}`);
    if (!names.length) fail(`${c.label}: no score row (expected ${DEFAULTS.combinedTitle} / ${DEFAULTS.titleA} / ${DEFAULTS.titleB})`);

    // every chip must carry a url, and no chip label may contain ':' (Stremio runs them through i18next)
    for (const l of body.meta.links || []) {
      if (!l.url || !l.category || !l.name) fail(`${c.label}: malformed chip ${JSON.stringify(l)}`);
      if (l.name.includes(':')) fail(`${c.label}: chip label contains a colon: ${l.name}`);
    }
  }

  const streamCfg = encodeConfig({ ...DEFAULTS, streamRow: true });
  const st = await (await fetch(`${base}/${streamCfg}/stream/movie/tt1160419.json`)).json();
  console.log(`\nstream row: ${st.streams.length} entry - ${st.streams[0] ? JSON.stringify(st.streams[0].description) : 'none'}`);

  const health = await (await fetch(`${base}/health`)).json();
  console.log(`health: ${JSON.stringify(health)}`);

  console.log(process.exitCode ? '\n== FAILURES ==' : '\n== all good ==');
  server.close();
  process.exit(process.exitCode || 0);
})();
