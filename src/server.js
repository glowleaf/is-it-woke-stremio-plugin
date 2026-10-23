'use strict';
// Woke Score - a Stremio addon that puts Is It Woke or Not? ratings on the detail page.
// No dependencies: plain node:http, so it runs anywhere with Node 18+.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const pkg = require('../package.json');
const { DEFAULTS, encodeConfig, decodeConfig, normalizeConfig } = require('./config');
const { Store } = require('./store');
const { ScoreDB } = require('./db');
const { fetchBaseMeta, fetchCatalogList, proxyCatalog } = require('./cinemeta');
const { resolve, bandOf, pageUrl, SITE } = require('./iiwon');
const iio = require('./isitwokeio');
const { decorateMeta, buildStream } = require('./format');
const { ALL_EXTRA } = require('./extra');
const { Index, CATALOGS, toCatalogMeta } = require('./catalog');

const PORT = Number(process.env.PORT) || 7090;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const INSTALL_HTML = (deep, manifestUrl) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install Woke Score in Stremio</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0d10;color:#eef2f6;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:18px}
.card{max-width:520px;width:100%;padding:30px;border-radius:18px;background:#14181d;border:1px solid #232a33;box-shadow:0 20px 60px #0008}
h1{margin:0 0 6px;font-size:22px}
p{margin:0 0 16px;color:#9aa7b4}
a.btn{display:block;text-align:center;padding:16px;border-radius:12px;background:#7b5cff;color:#fff;font-weight:700;text-decoration:none;font-size:18px}
a.btn:active{transform:scale(.99)}
input{width:100%;padding:10px;border-radius:8px;border:1px solid #2a323c;background:#0e1216;color:#cfe0ee;font:13px ui-monospace,Menlo,Consolas,monospace;box-sizing:border-box}
.small{margin-top:16px;font-size:13px;color:#7c8896}
</style></head><body><div class="card">
<h1>Woke Score for Stremio</h1>
<p>Woke scores from isitwokeornot.com, isitwoke.io, Wokeometer and Wokealyzer, on every movie and series page.</p>
<a class="btn" href="${deep}">Open in Stremio</a>
<p class="small" style="margin-bottom:6px">Nothing happened? Stremio must be installed on this device. On desktop you can also paste this into Stremio &rarr; Addons &rarr; &ldquo;Install from URL&rdquo;:</p>
<input readonly value="${manifestUrl}" onclick="this.select()">
<p class="small">On phones and TVs the score is also the first line of the description and an entry at the top of the sources list, so it shows even when this addon is not first in your list.</p>
</div></body></html>`;
const CONFIGURE_HTML = path.join(__dirname, '..', 'public', 'configure.html');
// Stremio shows the first meta that loads, so we answer with plain Cinemeta metadata if the
// lookup is slow. The lookup itself keeps running and warms the cache for the next open.
const DEADLINE_MS = Number(process.env.LOOKUP_DEADLINE_MS) || 4500;
const ADDON_ID = 'community.woke.iiwon';

const store = new Store(path.join(DATA_DIR, 'cache.json'));
const index = new Index(path.join(DATA_DIR, 'index.json'));
// Woke scores live in SQLite: a title is looked up on the two sites once, then always served
// from here (see src/db.js).
const db = new ScoreDB(path.join(DATA_DIR, 'woke.db'));

// The base addon's catalog list (Cinemeta's board rows + search), mirrored at startup so this
// addon can take its place completely when needed.
const cinemetaCatalogs = [];
async function loadCinemetaCatalogs() {
  try {
    const list = await fetchCatalogList(DEFAULTS.baseMeta, store);
    const clean = (list || []).filter((c) => c && typeof c.type === 'string' && typeof c.id === 'string');
    if (clean.length) {
      cinemetaCatalogs.length = 0;
      cinemetaCatalogs.push(...clean);
      console.log(`[catalogs] mirrored ${clean.length} catalogs from ${DEFAULTS.baseMeta}`);
    }
  } catch (err) {
    console.warn(`[catalogs] mirror failed: ${err.message}`);
  }
}
loadCinemetaCatalogs();
setInterval(loadCinemetaCatalogs, 6 * 60 * 60 * 1000).unref();

const withDeadline = (promise, ms) =>
  Promise.race([promise, new Promise((res) => setTimeout(() => res(null), ms).unref())]);

// Stremio's Android/TV clients render their own detail screen and do not draw the links chip row, so
// for them the score goes on the description line instead. Their requests carry no user-agent at all
// (verified from the live log: phone = no UA from the mobile IP, desktop app = WebView UA which does
// render the chips), so "mobile" here means: a mobile/TV UA *or* no user-agent.
const MOBILE_UA = /android|okhttp|dalvik|exoplayer|smarttv|aft[bmst]|bravia|tizen|web0s|iphone|ipad|ios/i;
function wantsDescription(cfg, ua) {
  if (cfg.description === true) return true;
  if (cfg.description === false) return false;
  const u = String(ua || '').trim();
  if (!u || u === '-') return true;
  return MOBILE_UA.test(u);
}

function yearOf(meta) {
  const fromRelease = parseInt(String((meta && meta.releaseInfo) || '').slice(0, 4), 10);
  if (Number.isFinite(fromRelease)) return fromRelease;
  const fromReleased = parseInt(String((meta && meta.released) || '').slice(0, 4), 10);
  return Number.isFinite(fromReleased) ? fromReleased : null;
}

function manifest(cfg) {
  const resources = [{ name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt'] }];
  if (cfg && cfg.streamRow) resources.push({ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] });
  const catalogs = [];
  // Mirror the base addon's catalogs (Cinemeta's board rows and search) so this addon can take
  // its place entirely - that is the only way to guarantee the chip rows appear, because Stremio
  // renders the first meta addon in the collection order and the official one is pinned first.
  for (const cat of cinemetaCatalogs) {
    catalogs.push({
      type: cat.type,
      id: cat.id,
      name: cat.name,
      ...(Array.isArray(cat.extra) ? { extra: cat.extra } : {}),
      ...(Array.isArray(cat.genres) ? { genres: cat.genres } : {}),
    });
  }
  if (cfg && cfg.catalogs !== false && index.size >= 50) {
    for (const def of CATALOGS) {
      for (const type of ['movie', 'series']) {
        catalogs.push({
          type,
          id: def.id,
          name: `${def.name} ${type === 'movie' ? 'Movies' : 'TV'}`,
          extra: [{ name: 'skip', isRequired: false }],
        });
      }
    }
  }
  if (catalogs.length) resources.push({ name: 'catalog', types: ['movie', 'series'] });
  return {
    id: ADDON_ID,
    version: pkg.version,
    name: 'Woke Score',
    description:
      'Shows woke scores on the movie/series page: a row of chips next to Genres and an entry at ' +
      'the top of the stream list. Two sources, one row each - isitwokeornot.com (manual editorial ' +
      'score) and isitwoke.io (AI analysis + verdict). For the chip row to appear it must be ABOVE ' +
      'Cinemeta in your addon order; the stream-list entry shows up either way.',
    types: ['movie', 'series'],
    catalogs,
    resources,
    idPrefixes: ['tt'],
    behaviorHints: { configurable: true, configurationRequired: false },
  };
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string';
  res.writeHead(status, {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'content-type': isJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8; charset=utf-8',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- handlers ----------

async function handleMeta(cfg, type, id, ua = '') {
  const imdbId = /^tt\d+/.test(id) ? id.split(':')[0] : null;
  if (!imdbId) return { status: 404, body: { err: 'unsupported id' } };

  let base = null;
  try {
    base = await fetchBaseMeta(cfg.baseMeta, type, imdbId, store);
  } catch (err) {
    console.warn(`[meta] base meta failed for ${type}/${imdbId}: ${err.message}`);
    return { status: 404, body: { err: 'no base metadata' } };
  }
  if (!base) return { status: 404, body: { err: 'not found' } };

  const sourceResults = await lookupSources(cfg, base, type, imdbId);
  if (sourceResults === null) {
    // Nothing answered in time: serve Cinemeta's page untouched, the lookups keep running.
    return { status: 200, body: { meta: base }, cache: 60 };
  }
  const hits = [sourceResults.iiwon, sourceResults.iio].filter(Boolean).length;
  const renderCfg = { ...cfg, description: wantsDescription(cfg, ua) };
  // Short TTL: the chip layout must be able to change without waiting out a long cache.
  return { status: 200, body: { meta: decorateMeta(base, sourceResults, renderCfg) }, cache: hits ? 300 : 120 };
}

// Both rating sources: SQLite first, upstream only for a title that has never been resolved.
// Returns { iiwon?, iio? } where each value is the rating or null (not rated); a source is
// absent when it is switched off. Returns null when every source timed out or errored.
async function lookupSources(cfg, base, type, imdbId) {
  const key = imdbId || (base && base.id) || '';
  const cached = cfg.refresh ? {} : db.lookup(key);
  const out = {};
  const jobs = [];

  if (cfg.srcIiwon) {
    const hit = cached.iiwon;
    if (hit) out.iiwon = hit.status === 'ok' ? hit.payload : null;
    else {
      const wanted = { imdbId, name: (base && base.name) || '', year: yearOf(base), type };
      jobs.push([
        'iiwon',
        async () => {
          const found = await resolve(wanted, store);
          if (found.status === 'ok') return { status: 'ok', rating: found.title };
          if (found.status === 'missing') return { status: 'missing' };
          return null; // upstream error: leave uncached so the next open retries
        },
      ]);
    }
  }

  const tmdbId = base && base.moviedb_id ? String(base.moviedb_id) : '';
  if (cfg.srcIio) {
    const hit = cached.iio;
    if (hit) out.iio = hit.status === 'ok' ? hit.payload : null;
    else {
      jobs.push([
        'iio',
        async () => {
          if (!/^\d{1,10}$/.test(tmdbId)) return { status: 'missing' };
          const rating = await iio.lookup(type, tmdbId, store);
          return rating ? { status: 'ok', rating } : { status: 'missing' };
        },
      ]);
    }
  }

  // Extra sources: same rules, own SQLite key each, score normalised to 0-100 by the client.
  for (const src of ALL_EXTRA) {
    if (!cfg[src.flag]) continue;
    const hit = cached[src.key];
    if (hit) {
      out[src.key] = hit.status === 'ok' ? hit.payload : null;
      continue;
    }
    jobs.push([
      src.key,
      async () => {
        const rating = await src.lookup(type, tmdbId, imdbId, (base && base.name) || '');
        return rating ? { status: 'ok', rating } : { status: 'missing' };
      },
    ]);
  }

  if (!jobs.length) {
    console.log(`[scores] ${key} -> sqlite (${Object.keys(out).join('+') || 'nothing'})`);
    return out;
  }

  let anyAnswer = Object.keys(out).length > 0;
  await Promise.all(
    jobs.map(async ([name, run]) => {
      const value = await withDeadline(
        Promise.resolve()
          .then(run)
          .catch((err) => {
            console.warn(`[scores] ${key} ${name} upstream error: ${err.message}`);
            return null;
          }),
        DEADLINE_MS,
      );
      if (value === null) {
        out[name] = null; // too slow / failed: nothing stored, so it is retried next time
        console.log(`[scores] ${key} ${name}=no-answer (not cached)`);
        return;
      }
      anyAnswer = true;
      if (value.status === 'ok') {
        out[name] = value.rating;
        db.save(key, name, 'ok', value.rating);
        console.log(`[scores] ${key} ${name}=fetched+stored`);
      } else {
        out[name] = null;
        db.save(key, name, 'missing');
        console.log(`[scores] ${key} ${name}=missing+stored`);
      }
    }),
  );
  return anyAnswer ? out : null;
}

async function handleStream(cfg, type, id) {
  if (!cfg.streamRow) return { status: 200, body: { streams: [] } };
  const imdbId = id.split(':')[0];
  let base = null;
  try {
    base = await fetchBaseMeta(cfg.baseMeta, type, imdbId, store);
  } catch {
    /* ignore */
  }
  if (!base) return { status: 200, body: { streams: [] }, cache: 300 };
  const results = (await lookupSources(cfg, base, type, imdbId)) || {};
  const stream = buildStream(results, cfg);
  return { status: 200, body: { streams: stream ? [stream] : [] }, cache: 600 };
}

function handleCatalog(cfg, type, rawId, extra) {
  const def = CATALOGS.find((c) => c.id === rawId);
  if (!def) {
    // Not one of our own rows: proxy the base addon's catalog, so this addon can fully stand in
    // for Cinemeta (board rows, search, everything) instead of fighting it for the meta slot.
    return proxyCatalog(cfg.baseMeta, type, rawId, extra).then(
      (metas) => ({ status: 200, body: { metas }, cache: 300 }),
      (err) => {
        console.warn(`[catalog] proxy failed for ${type}/${rawId}: ${err.message}`);
        return { status: 200, body: { metas: [] }, cache: 60 };
      },
    );
  }
  if (!cfg.catalogs) return Promise.resolve({ status: 200, body: { metas: [] } });
  const skip = Math.max(0, parseInt(extra.skip || '0', 10) || 0);
  const rows = index.query({ order: def.order, skip, limit: 100, type, scores: db.aggregates() });
  // Short TTL: the bulk warmer keeps changing these rankings while it fills the cache.
  return Promise.resolve({ status: 200, body: { metas: rows.map((r) => toCatalogMeta(r, type)) }, cache: 120 });
}

async function handlePreview(payload) {
  const cfg = normalizeConfig(payload.config || {}) || { ...DEFAULTS };
  const type = payload.type === 'series' ? 'series' : 'movie';
  const id = /^tt\d+$/.test(payload.id || '') ? payload.id : '';
  if (id) {
    const result = await handleMeta(cfg, type, id);
    return { status: result.status, body: result.body };
  }
  const name = String(payload.name || '').slice(0, 120);
  if (!name) return { status: 400, body: { err: 'give an imdb id or a name' } };
  const year = parseInt(payload.year, 10);
  const found = await resolve({ imdbId: null, name, year: Number.isFinite(year) ? year : null, type }, store);
  if (found.status !== 'ok') return { status: 200, body: { found: false, status: found.status } };
  const t = found.title;
  const base = { id: 'preview', type, name: t.name, releaseInfo: t.year ? String(t.year) : undefined };
  return {
    status: 200,
    body: { found: true, via: found.via, meta: decorateMeta(base, { iiwon: t }, cfg), detail: { ...t, pageUrl: pageUrl(t) } },
  };
}

// ---------- routing ----------

// Optional path prefix, so the addon can live under an existing hostname
// (e.g. BASE_PATH=/woke behind a tunnel: https://host/woke/manifest.json).
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = url.pathname;
  // The prefix is optional: the addon answers at both https://host/woke/... (path rule on a
  // shared hostname) and https://woke.host/... (its own hostname).
  if (BASE_PATH && pathname.startsWith(`${BASE_PATH}/`)) {
    pathname = pathname.slice(BASE_PATH.length);
  } else if (BASE_PATH && pathname === BASE_PATH) {
    pathname = '/';
  }
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (pathname === '/') return send(res, 302, '', { location: `${BASE_PATH}/configure` });
  if (pathname === '/health' || pathname === '/api/health') {
    return send(res, 200, { ok: true, version: pkg.version, index: index.size, cached: store.map.size, db: db.stats(), basePath: BASE_PATH || null });
  }
  if (pathname === '/manifest.json') return send(res, 200, manifest({ ...DEFAULTS }));

  if (parts[parts.length - 1] === 'configure' && parts.length <= 2) {
    return send(res, 200, fs.readFileSync(CONFIGURE_HTML, 'utf8'), { 'cache-control': 'no-cache' });
  }
  // Install helper page. Stremio's one-click install is a deep link: take the manifest URL and
  // replace https:// with stremio:// (that is exactly what the addon directories do). A CMS or a
  // chat app will not hand a stremio:// link to the OS, but an https page can, so this page is the
  // thing to link to from anywhere: https://host/woke/install  (or /woke/<config>/install).
  if (parts[parts.length - 1] === 'install' && parts.length <= 2) {
    let seg = encodeConfig({ v: 2 }); // the compact canonical default (eyJ2IjoyfQ)
    if (parts.length === 2) {
      if (!decodeConfig(parts[0])) return send(res, 400, { err: 'invalid config in url' });
      seg = parts[0];
    }
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
    const manifestUrl = `${proto}://${host}${BASE_PATH}/${seg}/manifest.json`;
    const deep = `stremio://${manifestUrl.replace(/^[a-z]+:\/\//i, '')}`;
    return send(res, 200, INSTALL_HTML(deep, manifestUrl), { 'cache-control': 'no-cache' });
  }
  // Generated site preview: /site/... serves the static pages built by tools/build_site.js, so the
  // pages can be looked at (and linked) before the real subdomain exists.
  if (parts[0] === 'site' && (req.method === 'GET' || req.method === 'HEAD')) {
    const root = path.join(__dirname, '..', 'site');
    const rel = parts.slice(1).join('/') || 'index.html';
    const file = path.join(root, rel);
    if (rel.includes('..') || !file.startsWith(root)) return send(res, 400, { err: 'bad path' });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { err: 'not found' });
    return send(res, 200, fs.readFileSync(file, 'utf8'), { 'cache-control': 'no-cache' });
  }
  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'preview') {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { err: 'invalid json' });
    }
    return send(res, 200, (await handlePreview(payload)).body);
  }

  if (parts.length < 2) return send(res, 404, { err: 'not found' });
  const cfg = decodeConfig(parts[0]);
  if (!cfg) return send(res, 400, { err: 'invalid config in url' });
  if (parts[1] === 'manifest.json' && parts.length === 2) return send(res, 200, manifest(cfg));

  const resource = parts[1];
  const type = parts[2];
  const rawId = parts[3];
  if (!['movie', 'series'].includes(type) || !rawId) return send(res, 404, { err: 'not found' });
  const id = rawId.replace(/\.json$/, '');

  if (resource === 'meta') {
    if (!/^tt\d+(:\d+:\d+)?$/.test(id)) return send(res, 404, { err: 'unsupported id' });
    const result = await handleMeta(cfg, type, id, String(req.headers['user-agent'] || ''));
    const headers = result.cache ? { 'cache-control': `public, max-age=${result.cache}` } : {};
    return send(res, result.status, result.body, headers);
  }
  if (resource === 'stream') {
    const result = await handleStream(cfg, type, id.split(':')[0]);
    return send(res, result.status, result.body, { 'cache-control': `public, max-age=${result.cache}` });
  }
  if (resource === 'catalog') {
    const extra = parts[4] ? Object.fromEntries(new URLSearchParams(parts[4].replace(/\.json$/, ''))) : {};
    const result = await handleCatalog(cfg, type, id, extra);
    return send(res, result.status, result.body, { 'cache-control': `public, max-age=${result.cache}` });
  }
  return send(res, 404, { err: 'not found' });
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  res.on('finish', () => {
    // One line per request, including the client (and the CF-reported source IP), so "which
    // device is talking to us?" is answerable without guessing.
    const ua = String(req.headers['user-agent'] || '-').slice(0, 50);
    const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-').split(',')[0].slice(0, 24);
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms ua="${ua}" ip=${ip}`);
  });
  route(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, 500, { err: 'internal error' });
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Woke Score addon v${pkg.version} on http://${HOST}:${PORT}${BASE_PATH}/configure (index: ${index.size})`);
  });
}

module.exports = { server, manifest, route, index, store, db };
