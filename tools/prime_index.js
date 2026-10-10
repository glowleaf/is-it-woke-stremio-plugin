'use strict';
// Builds data/index.json: every reviewed title with its IMDb id, so that
//   1. addon lookups skip the name-matching step entirely, and
//   2. the browse catalogs ("Least Woke Movies", ...) can be served.
//
// The public list endpoint is capped at 12 rows per page, so this walks page by page and then
// reads each title's detail (the only place the IMDb id is exposed). It is polite, resumable
// and incremental - re-run it any time; it only fetches what is missing.
//
// The site rate-limits (429) if pushed, so this paces itself AND backs off hard on 429:
// the effective rate halves, waits, and retries the same request. Keep --rate at or below 1
// requests/second for a full crawl.
//
//   node tools/prime_index.js                 # 1 request/second, all pages
//   node tools/prime_index.js --rate 0.5 --pages 20
//   node tools/prime_index.js --refresh       # re-read everything

const fs = require('node:fs');
const path = require('node:path');

const { getJson, UpstreamError } = require('../src/http');
const { compact, SITE } = require('../src/iiwon');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const STATE_FILE = path.join(DATA_DIR, 'prime-state.json');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const MAX_RATE = Math.min(5, Math.max(0.05, Number(argOf('rate', 1)) || 1));
const MAX_PAGES = Number(argOf('pages', 0)) || Infinity;
const REFRESH = args.includes('--refresh');
const BACKOFF_MS = Number(argOf('backoff', 60000)) || 60000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

async function main() {
  const index = loadJson(INDEX_FILE, {});
  const state = loadJson(STATE_FILE, { lastPage: 0, done: false });
  let added = 0;
  let failed = 0;
  let retries = 0;
  let throttles = 0;
  let requests = 0;
  let stopped = false;
  let rate = MAX_RATE;

  const stop = () => {
    stopped = true;
    saveJson(INDEX_FILE, index);
    saveJson(STATE_FILE, state);
    console.log(`\n[prime] stopped - ${Object.keys(index).length} titles in the index (${added} new, ${failed} failed, ${requests} requests)`);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  let nextSlot = 0;
  async function paced(fn) {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + 1000 / rate;
    if (wait) await sleep(wait);
    requests += 1;
    return fn();
  }

  // One request, with 429 backoff: halve the rate, wait, try again (a few times).
  async function fetchWithBackoff(url, attempts = 4) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await paced(() => getJson(url));
      } catch (err) {
        const throttled = err instanceof UpstreamError && err.status === 429;
        if (!throttled || attempt === attempts || stopped) throw err;
        throttles += 1;
        rate = Math.max(0.1, rate / 2);
        const wait = Math.min(BACKOFF_MS, 15000 * attempt);
        console.warn(`[prime] 429 - backing off ${Math.round(wait / 1000)}s, rate now ${rate.toFixed(2)} req/s`);
        await sleep(wait);
        retries += 1;
      }
    }
    throw new Error('unreachable');
  }

  let page = state.done ? 1 : Math.max(1, state.lastPage || 1);
  let consecutivePageFailures = 0;

  for (; page <= MAX_PAGES; page += 1) {
    if (stopped) break;
    let listing;
    try {
      listing = await fetchWithBackoff(`${SITE}/api/titles?page=${page}&limit=12`);
      consecutivePageFailures = 0;
    } catch (err) {
      failed += 1;
      consecutivePageFailures += 1;
      console.warn(`[prime] page ${page} failed: ${err.message}`);
      if (consecutivePageFailures >= 5) {
        console.warn('[prime] too many page failures in a row, stopping (re-run later to resume)');
        break;
      }
      page -= 1; // retry the same page next round
      continue;
    }
    const rows = (listing && listing.data) || [];
    if (!rows.length) break;
    const totalPages = (listing && listing.totalPages) || 0;

    for (const row of rows) {
      if (stopped) break;
      if (!row || !row.slug) continue;
      if (index[row.slug] && !REFRESH) continue; // re-runs only fetch what is missing
      try {
        const detail = await fetchWithBackoff(`${SITE}/api/titles/${encodeURIComponent(row.slug)}`);
        if (detail && Number.isFinite(detail.wokeScore)) {
          const t = compact(detail);
          index[row.slug] = {
            slug: t.slug,
            name: t.name,
            year: t.year,
            type: t.type,
            score: t.score,
            band: t.band ? t.band.label : null,
            imdbId: t.imdbId,
            poster: t.poster,
            fetchedAt: Date.now(),
          };
          added += 1;
        }
      } catch (err) {
        failed += 1;
        if (failed % 25 === 0) console.warn(`[prime] ${failed} failures so far (last: ${err.message})`);
      }
      if (added % 25 === 0 && added > 0) {
        saveJson(INDEX_FILE, index);
        saveJson(STATE_FILE, { lastPage: page, done: false });
        console.log(`[prime] page ${page}/${totalPages || '?'} - ${Object.keys(index).length} titles indexed (rate ${rate.toFixed(2)} req/s, ${throttles} throttles)`);
      }
    }
    state.lastPage = page + 1;
    saveJson(INDEX_FILE, index);
    saveJson(STATE_FILE, { lastPage: page + 1, done: false });
    if (totalPages && page >= totalPages) {
      state.done = true;
      break;
    }
  }

  saveJson(INDEX_FILE, index);
  saveJson(STATE_FILE, { lastPage: page, done: state.done === true });
  const size = Object.keys(index).length;
  const withImdb = Object.values(index).filter((r) => r.imdbId).length;
  console.log(`[prime] done - ${size} titles indexed (${withImdb} with an IMDb id), ${added} new, ${failed} failed, ${retries} retries, ${throttles} throttles, ${requests} requests`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
