'use strict';
// Client for isitwokeornot.com.
//
// The site is a Next.js app; its own search page calls a public, key-less JSON endpoint:
//   GET /api/titles?q=<name>&limit=12&page=1     -> list (name, year, wokeScore, ...)
//   GET /api/titles/<slug>                       -> full detail, incl. imdbUrl (the tt id)
// The docs page advertises a paid API ($7/mo) for bulk/imdb_id lookups; everything this
// addon needs is available from the free endpoints above, so no key is required.
//
// Lookup strategy: Stremio hands us an IMDb id, the site wants a slug. We ask Cinemeta for
// the title/year, search the site by name, then VERIFY the IMDb id against the candidate's
// own imdbUrl before trusting the match. Verified matches are stored permanently.

const { getJson } = require('./http');

const SITE = 'https://isitwokeornot.com';
const DETAIL_TTL = 24 * 60 * 60 * 1000;
const SEARCH_TTL = 24 * 60 * 60 * 1000;
const MISS_TTL = 6 * 60 * 60 * 1000;

// Score bands used by the site itself (0-19 / 20-39 / 40-59 / 60-79 / 80-100).
// `step` is a shared 0(best)-4(worst) index so both rating sources use one marker legend.
const BANDS = [
  [80, 'superWoke', 'Super woke', '#991b1b', 4],
  [60, 'veryWoke', 'Very woke', '#dc2626', 3],
  [40, 'woke', 'Woke', '#ea580c', 2],
  [20, 'slightlyWoke', 'Slightly woke', '#eab308', 1],
  [0, 'notWoke', 'Not woke', '#16a34a', 0],
];

const MARKER_STEPS = {
  squares: ['🟩', '🟨', '🟧', '🟥', '⬛'],
  circles: ['🟢', '🟡', '🟠', '🔴', '⚫'],
  none: ['', '', '', '', ''],
};

function markerForStep(step, style = 'squares') {
  const set = MARKER_STEPS[style] || MARKER_STEPS.squares;
  const i = Math.min(4, Math.max(0, Number(step) || 0));
  return set[i];
}

function bandOf(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  for (const [min, key, label, color, step] of BANDS) if (n >= min) return { key, label, color, step };
  return null;
}

function markerOf(score, style = 'squares') {
  const band = bandOf(score);
  return band ? markerForStep(band.step, style) : '';
}

const SITE_TYPE = { movie: 'MOVIE', series: 'TV_SHOW' };
const SITE_PATH = { MOVIE: 'movie', TV_SHOW: 'tv' };

function pageUrl(title) {
  return `${SITE}/${SITE_PATH[title.type] || 'movie'}/${title.slug}`;
}

function searchUrl(name) {
  return `${SITE}/search?q=${encodeURIComponent(name)}`;
}

function imdbIdFromUrl(url) {
  const m = /\/title\/(tt\d+)/.exec(String(url || ''));
  return m ? m[1] : null;
}

function compact(d) {
  const year = d.releaseDate ? Number(String(d.releaseDate).slice(0, 4)) : null;
  return {
    slug: d.slug,
    name: d.name,
    type: d.type,
    year: Number.isFinite(year) ? year : null,
    score: typeof d.wokeScore === 'number' ? d.wokeScore : null,
    band: bandOf(d.wokeScore),
    summary: typeof d.wokeSummary === 'string' ? d.wokeSummary : '',
    imdbId: imdbIdFromUrl(d.imdbUrl),
    imdbRating: typeof d.imdbRating === 'number' ? d.imdbRating : null,
    rtCritics: typeof d.rottenTomatoesCriticsScore === 'number' ? d.rottenTomatoesCriticsScore : null,
    rtAudience: typeof d.rottenTomatoesAudienceScore === 'number' ? d.rottenTomatoesAudienceScore : null,
    metacritic: typeof d.metacriticScore === 'number' ? d.metacriticScore : null,
    runtime: typeof d.runtimeMinutes === 'number' ? d.runtimeMinutes : null,
    ageRating: d.ageRating || null,
    poster: d.posterUrl || null,
    genres: Array.isArray(d.genres) ? d.genres.map((g) => g && g.name).filter(Boolean) : [],
    factors: Array.isArray(d.wokeFactors)
      ? d.wokeFactors
          .filter((f) => f && f.label)
          .slice()
          .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
          .map((f) => ({ label: String(f.label), weight: Number(f.weight) || 0 }))
      : [],
    fetchedAt: Date.now(),
  };
}

// ---------- name matching ----------

function norm(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripArticle(s) {
  return s.replace(/^(the|a|an|le|la|les|el|los|las|der|die|das|il|lo)\s+/, '');
}

// 0-12ish. Name carries most of the weight; year and type break ties.
function scoreCandidate(want, cand) {
  const a = norm(want.name);
  const b = norm(cand.name);
  if (!a || !b) return -1;
  let score = 0;
  if (a === b) score += 6;
  else if (stripArticle(a) === stripArticle(b)) score += 5;
  else if (a.startsWith(b) || b.startsWith(a)) score += 3;
  else if (a.includes(b) || b.includes(a)) score += 2;
  else return -1;

  const candYear = cand.releaseDate ? Number(String(cand.releaseDate).slice(0, 4)) : null;
  if (want.year && candYear) {
    const d = Math.abs(want.year - candYear);
    if (d === 0) score += 3;
    else if (d === 1) score += 1;
    else score -= 1;
  }
  if (want.siteType && cand.type) score += cand.type === want.siteType ? 2 : -3;
  return score;
}

async function search(query, store) {
  const key = `s:${norm(query)}`;
  const cached = store.get(key);
  if (cached !== undefined) return cached;
  let rows = [];
  try {
    const data = await getJson(`${SITE}/api/titles?q=${encodeURIComponent(query)}&limit=12&page=1`);
    if (data && Array.isArray(data.data)) rows = data.data;
  } catch (err) {
    console.warn(`[iiwon] search failed for "${query}": ${err.message}`);
    throw err;
  }
  store.set(key, rows, rows.length ? SEARCH_TTL : MISS_TTL);
  return rows;
}

async function getTitle(slug, store) {
  const key = `t:${slug}`;
  const cached = store.get(key);
  if (cached) return cached;
  const data = await getJson(`${SITE}/api/titles/${encodeURIComponent(slug)}`);
  if (!data || typeof data.wokeScore !== 'number') return null;
  const title = compact(data);
  store.set(key, title, DETAIL_TTL);
  if (title.imdbId) store.set(`idx:${title.imdbId}`, title.slug, 0);
  return title;
}

// Resolve { imdbId, name, year, type } -> site title (or a 'missing' status).
async function resolve({ imdbId, name, year, type }, store) {
  const want = { name, year, siteType: SITE_TYPE[type] || null };

  // 1. Permanent imdbId -> slug mapping from earlier lookups.
  if (imdbId) {
    const slug = store.get(`idx:${imdbId}`);
    if (slug) {
      try {
        const known = await getTitle(slug, store);
        if (known && known.imdbId === imdbId) return { status: 'ok', title: known, via: 'index' };
      } catch (err) {
        console.warn(`[iiwon] index refresh failed for ${imdbId}: ${err.message}`);
      }
    }
  }

  // 2. Search the site by name and rank the candidates.
  const queries = [name];
  const shortened = String(name || '').replace(/\s*[:\u2013-]\s.*$/, '').trim();
  if (shortened && shortened !== name && shortened.length > 2) queries.push(shortened);
  if (year) queries.push(`${name} ${year}`);

  let best = null;
  for (const query of queries) {
    let rows;
    try {
      rows = await search(query, store);
    } catch {
      return { status: 'error', reason: 'search failed' };
    }
    const ranked = rows
      .map((c) => ({ cand: c, score: scoreCandidate(want, c) }))
      .filter((r) => r.score >= 2)
      .sort((a, b) => b.score - a.score);
    if (ranked.length) {
      best = ranked;
      break;
    }
  }
  if (!best || !best.length) return { status: 'missing' };

  // 3. Verify the IMDb id against the candidate's own imdbUrl before trusting it.
  for (const { cand, score } of best.slice(0, 3)) {
    let title;
    try {
      title = await getTitle(cand.slug, store);
    } catch (err) {
      console.warn(`[iiwon] detail failed for ${cand.slug}: ${err.message}`);
      continue;
    }
    if (!title) continue;
    if (imdbId) {
      if (title.imdbId === imdbId) return { status: 'ok', title, via: 'verified' };
      continue;
    }
    if (score >= 8) return { status: 'ok', title, via: 'name' };
  }
  return { status: 'missing' };
}

module.exports = {
  SITE,
  BANDS,
  MARKER_STEPS,
  bandOf,
  markerOf,
  markerForStep,
  pageUrl,
  searchUrl,
  imdbIdFromUrl,
  compact,
  search,
  getTitle,
  resolve,
  norm,
  scoreCandidate,
};
