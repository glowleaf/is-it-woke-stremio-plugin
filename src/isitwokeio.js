'use strict';
// Client for isitwoke.io ("Is it Woke?" - AI analysis, movies / TV / games / books).
//
// Its pages are keyed by TMDB id (/movie/<tmdb id>, /tv/<tmdb id>), which Cinemeta already
// hands us as `moviedb_id`, so no name matching is needed: one request per title, no key.
// The site publishes no API, but every page ships its verdict card in the Next.js flight
// payload - we request the flight payload directly with the `RSC: 1` header and read the
// score, the verdict label and the short reasons out of it.
//
// Verdict bands (from the site's own bundle):
//   0-20 Absolute Cinema | 21-40 Very Little Woke | 41-60 Slightly Woke
//   61-80 Very Woke      | 81-100 Certified Woke Trash

const { getText } = require('./http');

const SITE = 'https://isitwoke.io';
const TTL = 24 * 60 * 60 * 1000;
const MISS_TTL = 6 * 60 * 60 * 1000;

// [minScore, key, label, step] - step matches the shared 0(best)-4(worst) marker scale.
const BANDS = [
  [81, 'certifiedWokeTrash', 'Certified Woke Trash', 4],
  [61, 'veryWoke', 'Very Woke', 3],
  [41, 'slightlyWoke', 'Slightly Woke', 2],
  [21, 'veryLittleWoke', 'Very Little Woke', 1],
  [0, 'absoluteCinema', 'Absolute Cinema', 0],
];

const SITE_PATH = { movie: 'movie', series: 'tv' };

function bandOf(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  for (const [min, key, label, step] of BANDS) if (n >= min) return { key, label, step };
  return null;
}

function pageUrl(type, tmdbId) {
  return `${SITE}/${SITE_PATH[type] || 'movie'}/${tmdbId}`;
}

// The payload arrives with quotes escaped as \" - collapse those runs so the verdict card
// becomes plain JSON we can match.
function unescapeFlight(text) {
  return text.replace(/\\+"/g, '"');
}

function parseVerdict(text) {
  const flat = unescapeFlight(text);
  const m = /"title":"([^"]*)","wokeScore":(\d+),"verdictLabel":"([^"]*)"/.exec(flat);
  if (!m) return null;
  const reasons = [];
  const start = flat.indexOf('"shortReasons":[', m.index);
  if (start >= 0) {
    const open = flat.indexOf('[', start);
    const close = flat.indexOf(']', open);
    if (open > 0 && close > open) {
      try {
        const list = JSON.parse(flat.slice(open, close + 1));
        if (Array.isArray(list)) for (const r of list) if (typeof r === 'string') reasons.push(r);
      } catch {
        /* ignore malformed reason list */
      }
    }
  }
  const score = Number(m[2]);
  return {
    site: 'isitwoke.io',
    title: m[1],
    score,
    verdictLabel: m[3],
    band: bandOf(score),
    reasons: reasons.slice(0, 5),
    fetchedAt: Date.now(),
  };
}

async function lookup(type, tmdbId, store) {
  if (!/^\d{1,10}$/.test(String(tmdbId || ''))) return null;
  const key = `iio:${type}:${tmdbId}`;
  const cached = store.get(key);
  if (cached !== undefined) return cached;

  const url = pageUrl(type, tmdbId);
  let text = null;
  try {
    text = await getText(url, { headers: { RSC: '1', accept: 'text/x-component' } });
  } catch (err) {
    console.warn(`[isitwoke.io] flight payload failed for ${type}/${tmdbId}: ${err.message}`);
    try {
      text = await getText(url);
    } catch (err2) {
      console.warn(`[isitwoke.io] page failed for ${type}/${tmdbId}: ${err2.message}`);
      throw err2;
    }
  }

  const rating = text ? parseVerdict(text) : null;
  if (rating) {
    rating.type = type;
    rating.tmdbId = String(tmdbId);
  }
  store.set(key, rating, rating ? TTL : MISS_TTL);
  if (rating) store.set(`iio-idx:${type}:${tmdbId}`, rating, 0);
  return rating;
}

module.exports = { SITE, BANDS, bandOf, pageUrl, parseVerdict, lookup };
