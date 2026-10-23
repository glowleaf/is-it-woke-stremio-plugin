'use strict';
// Three more per-title sources, all keyless:
//
//   wokemoviescore.com  /movie/<title-slug>-<year>/  -> Woke Score 0-100 AND ten marker scores
//                       (Representation/Casting, LGBTQ+ Themes, Feminist Agenda, Racial
//                        Consciousness, Climate Crusade, Eat the Rich, Body Positivity,
//                        Neurodivergence, Revisionist History, Lecture Energy)
//   wokenessratings.com /media/<title-slug>-<year>-<movie|series>  -> Next.js payload with
//                       wokeness_score / feminism_score / chickflick_score, published 0-10
//   virtuevigil.com     /reviews/<title-slug>-<year>/  -> "Woke Score: X/50" (also a Traditional score)
//
// Scores are normalised to the same 0-100 the aggregate uses. Marker/theme data is kept, because it
// is the only per-theme evidence two of these sources publish.

const { getText } = require('./http');

const norm = (v) => Math.max(0, Math.min(100, Math.round(v)));

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function tryUrls(urls) {
  for (const url of urls) {
    try {
      const html = await getText(url);
      if (html && html.length > 500) return { url, html };
    } catch (e) { /* next candidate */ }
  }
  return null;
}

async function lookupWokeMovieScore(type, imdbId, name, year) {
  const s = slugify(name);
  const y = year ? String(year) : null;
  const base = type === 'series'
    ? [`https://wokemoviescore.com/tv/${s}${y ? `-${y}` : ''}/`, `https://wokemoviescore.com/series/${s}${y ? `-${y}` : ''}/`]
    : [`https://wokemoviescore.com/movie/${s}${y ? `-${y}` : ''}/`, `https://wokemoviescore.com/movie/${s}/`];
  const hit = await tryUrls(base);
  if (!hit) return null;
  const u = hit.html.replace(/\\"/g, '"');
  const pairs = [...u.matchAll(/"name"\s*:\s*"([^"]{3,45})"\s*,\s*"value"\s*:\s*([\d.]+)/g)]
    .map((m) => [m[1], Number(m[2])]);
  const overall = pairs.find(([n]) => /^woke score$/i.test(n));
  if (!overall) return null;
  const markers = {};
  for (const [n, v] of pairs) {
    if (/^woke score$/i.test(n)) continue;
    markers[n] = norm(v);
  }
  return {
    site: 'wokemoviescore.com',
    score: norm(overall[1]),
    native: overall[1],
    scale: 100,
    label: `woke score ${Math.round(overall[1])}/100`,
    url: hit.url,
    title: name,
    markers,
  };
}

async function lookupWokenessRatings(type, imdbId, name, year) {
  const s = slugify(name);
  if (!year) return null;
  const kind = type === 'series' ? 'series' : 'movie';
  const hit = await tryUrls([`https://wokenessratings.com/media/${s}-${year}-${kind}`, `https://wokenessratings.com/media/${s}-${year}-${kind}/`]);
  if (!hit) return null;
  const m = hit.html.match(/"media":\{[^}]*\}/);
  if (!m) return null;
  let media;
  try {
    media = JSON.parse('{' + m[0] + '}').media;
  } catch (e) {
    return null;
  }
  if (typeof media.wokeness_score !== 'number') return null;
  return {
    site: 'wokenessratings.com',
    score: norm(media.wokeness_score * 10),
    native: media.wokeness_score,
    scale: 10,
    label: `wokeness ${media.wokeness_score}/10`,
    url: `https://wokenessratings.com/media/${media.slug}`,
    title: media.title,
    markers: {
      Feminism: norm((media.feminism_score || 0) * 10),
      'Chick Flick': norm((media.chickflick_score || 0) * 10),
    },
    confidence: media.rating_confidence,
  };
}

async function lookupVirtueVigil(type, imdbId, name, year) {
  const s = slugify(name);
  if (!year) return null;
  const hit = await tryUrls([`https://virtuevigil.com/reviews/${s}-${year}/`]);
  if (!hit) return null;
  const woke = hit.html.match(/Woke Score[:\s]*([\d.]+)\s*\/\s*50/i);
  if (!woke) return null;
  const traditional = hit.html.match(/Traditional Score[:\s]*([\d.]+)\s*\/\s*50/i);
  const scaled = Number(woke[1]) * 2; // 0-50 published -> 0-100
  return {
    site: 'virtuevigil.com',
    score: norm(scaled),
    native: Number(woke[1]),
    scale: 50,
    label: `woke ${woke[1]}/50`,
    url: hit.url,
    title: name,
    markers: traditional ? { Traditional: norm(Number(traditional[1]) * 2) } : {},
  };
}

const EXTRA_SOURCES_2 = [
  { key: 'wokemovie', short: 'Woke Movie Score', flag: 'srcWokeMovie', lookup: lookupWokeMovieScore },
  { key: 'wokenessratings', short: 'Wokeness Ratings', flag: 'srcWokenessRatings', lookup: lookupWokenessRatings },
  { key: 'virtuevigil', short: 'Virtue Vigil', flag: 'srcVirtueVigil', lookup: lookupVirtueVigil },
];

module.exports = { EXTRA_SOURCES_2, lookupWokeMovieScore, lookupWokenessRatings, lookupVirtueVigil, slugify };
