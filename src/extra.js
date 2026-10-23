'use strict';
// Extra woke-score sources. Both are keyless and both are keyed by an id the addon already has,
// so a match can be verified instead of guessed:
//   wokeometer.app  /api/search?q=<name> -> results[] carrying external_id (TMDB id) + woke_score 0-10
//   wokealyzer.com  /api/search?q=<name> -> movies[] carrying imdbId + score 0-10
// They publish 0-10, so scores are normalised to 0-100 (x10) to sit in the same aggregate as the
// two 0-100 sites. Each source is stored in SQLite under its own key, so nothing is fetched twice.

const { getJson } = require('./http');

const WOKEOMETER = 'https://wokeometer.app';
const WOKEALYZER = 'https://wokealyzer.com';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// 0-10 -> 0-100, so every source can share one aggregate.
function normalise(score) {
  return Math.max(0, Math.min(100, Math.round(score * 10)));
}

async function lookupWokeometer(type, tmdbId, imdbId, name) {
  if (!/^\d{1,10}$/.test(String(tmdbId || '')) || !name) return null;
  const data = await getJson(`${WOKEOMETER}/api/search?q=${encodeURIComponent(name)}`);
  const rows = data && Array.isArray(data.results) ? data.results : [];
  const wantType = type === 'series' ? 'tv' : 'movie';
  const sameId = rows.filter((r) => String(r.external_id) === String(tmdbId));
  const hit = sameId.find((r) => !r.media_type || r.media_type === wantType) || sameId[0];
  const native = hit ? num(hit.woke_score) : null;
  if (native === null) return null;
  return {
    site: 'wokeometer.app',
    score: normalise(native),
    native,
    scale: 10,
    label: `woke ${native}/10`,
    url: `${WOKEOMETER}/`,
    title: hit.title,
    year: hit.release_date ? Number(String(hit.release_date).slice(0, 4)) : null,
  };
}

async function lookupWokealyzer(type, tmdbId, imdbId, name) {
  if (!imdbId || !name) return null;
  const data = await getJson(`${WOKEALYZER}/api/search?q=${encodeURIComponent(name)}`);
  const rows = data && Array.isArray(data.movies) ? data.movies : [];
  // their results carry the IMDb id, so the match is exact - no guessing
  const hit = rows.find((r) => r.imdbId === imdbId);
  const native = hit ? num(hit.score) : null;
  if (native === null) return null;
  return {
    site: 'wokealyzer.com',
    score: normalise(native),
    native,
    scale: 10,
    label: `score ${native}/10`,
    url: `${WOKEALYZER}/movie/${imdbId}`,
    title: hit.title,
    year: hit.year,
  };
}

// Wired in order: the aggregate averages every source that answered, so adding more here is all
// it takes (the scrut score will be the next entry).
const EXTRA_SOURCES = [
  { key: 'wokeometer', short: 'Wokeometer', flag: 'srcWokeometer', lookup: lookupWokeometer },
  { key: 'wokealyzer', short: 'Wokealyzer', flag: 'srcWokealyzer', lookup: lookupWokealyzer },
];

// Wokemoviescore, Wokeness Ratings and Virtue Vigil are registered in extra2.js; one combined list
// is what the server and the formatter iterate, so a new source is added in exactly one place.
const { EXTRA_SOURCES_2 } = require('./extra2');
const ALL_EXTRA = [...EXTRA_SOURCES, ...EXTRA_SOURCES_2];

module.exports = { EXTRA_SOURCES, ALL_EXTRA, lookupWokeometer, lookupWokealyzer, normalise };
