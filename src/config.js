'use strict';
// User configuration is base64url(JSON) carried in the addon URL:
//   https://host/<config>/manifest.json
// That is the standard Stremio way of configuring an addon.

const DEFAULT_BASE_META = 'https://v3-cinemeta.strem.io';

const DEFAULTS = Object.freeze({
  srcIiwon: true, // isitwokeornot.com (manual editorial score)
  srcIio: true, // isitwoke.io (AI analysis + verdict)
  srcWokeometer: true, // wokeometer.app (AI score, 0-10 normalised to 0-100, keyed by TMDB id)
  srcWokealyzer: true, // wokealyzer.com (AI score, 0-10 normalised to 0-100, keyed by IMDb id)
  srcWokeMovie: true, // wokemoviescore.com (0-100 score + ten marker scores: LGBTQ+, feminist agenda, ...)
  srcWokenessRatings: true, // wokenessratings.com (wokeness/feminism/chickflick 0-10, slug by title+year)
  srcVirtueVigil: true, // virtuevigil.com (woke score published out of 50)
  titleA: 'Is It Woke or Not?', // chip row title for the first source
  titleB: 'Is It Woke (isitwoke.io)', // chip row title for the second source
  markers: 'squares', // 'squares' | 'circles' | 'none'
  band: true, // include the band/verdict label, e.g. "Slightly woke 39%"
  factors: true, // extra chip row with the biggest score factors
  combine: true, // one row holding both sources instead of one row per source
  combinedTitle: 'Woke Score', // row title when combined
  overall: true, // prepend an aggregate chip when 2+ sources have a score
  aggregateMethod: 'mean', // 'mean' (Metacritic-style average of normalised scores) | 'median' (resists one outlier)
  // How much each source counts in the Overall number. Measured over 22 titles: Wokealyzer is the
  // only source that reproduces the human editorial ranking (Spearman 0.90 against isitwokeornot,
  // mean gap 10.7 points, against 0.27-0.67 for the other pairs) and it covers every title, so it
  // counts double. Its LEVEL runs hotter than the other AI sites (mean 33.5 vs 19), which is why it
  // is not weighted higher than that.
  weights: { iiwon: 1, iio: 1, wokeometer: 1, wokealyzer: 2 },
  imdbBadge: false, // do NOT touch the IMDb badge in the header row
  link: false, // extra "↗ Review" chips (the score chips are links already)
  missing: false, // don't render a chip for sources that haven't rated the title (they just drop out)
  refresh: false, // true = ignore the SQLite copy and re-fetch this title once (then store it again)
  description: 'auto', // score line in the description for MOBILE/TV clients only ('auto'), because their
  // detail screen has no chip row; desktop/web keep just the chips. 'true' = always, 'false' = never.
  placement: 'top', // rows above ('top') or below ('bottom') Genres/Cast
  streamRow: true, // also add a scores entry at the top of the stream list - this shows up
  // whether or not the addon is first in the list, so it is on by default
  catalogs: true, // browse catalogs (need the local index; see tools/prime_index.js)
  baseMeta: DEFAULT_BASE_META, // addon whose metadata gets decorated (Cinemeta)
});

const ENUMS = {
  markers: ['squares', 'circles', 'none'],
  placement: ['top', 'bottom'],
  aggregateMethod: ['mean', 'median'],
};

function encodeConfig(cfg) {
  return Buffer.from(JSON.stringify(cfg), 'utf8').toString('base64url');
}

function decodeConfig(str) {
  let raw;
  try {
    raw = JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  return normalizeConfig(raw);
}

function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cfg = { ...DEFAULTS };
  // sectionTitle was the v1.0 name of the first row title.
  const strings = {
    titleA: raw.titleA !== undefined ? raw.titleA : raw.sectionTitle,
    titleB: raw.titleB,
    combinedTitle: raw.combinedTitle,
  };
  for (const [key, value] of Object.entries(strings)) {
    if (typeof value === 'string') cfg[key] = value.trim().slice(0, 40) || DEFAULTS[key];
  }
  const flags = ['band', 'factors', 'link', 'imdbBadge', 'missing', 'refresh', 'description', 'streamRow', 'catalogs', 'srcIiwon', 'srcIio', 'srcWokeometer', 'srcWokealyzer', 'srcWokeMovie', 'srcWokenessRatings', 'srcVirtueVigil', 'combine', 'overall'];
  for (const key of flags) {
    if (typeof raw[key] === 'boolean') cfg[key] = raw[key];
  }
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (typeof raw[key] === 'string' && allowed.includes(raw[key])) cfg[key] = raw[key];
  }
  if (typeof raw.description === 'string' && ['auto', 'true', 'false'].includes(raw.description)) {
    cfg.description = raw.description === 'true' ? true : raw.description === 'false' ? false : 'auto';
  }
  if (typeof raw.baseMeta === 'string' && /^https?:\/\//.test(raw.baseMeta)) {
    cfg.baseMeta = raw.baseMeta.trim().replace(/\/+$/, '').slice(0, 200);
  }
  // Per-source weights for the Overall number: 0.5x .. 3x, half steps.
  if (raw.weights && typeof raw.weights === 'object') {
    for (const key of ['iiwon', 'iio', 'wokeometer', 'wokealyzer']) {
      const v = Number(raw.weights[key]);
      if (Number.isFinite(v) && v >= 0.5 && v <= 3) {
        cfg.weights = { ...cfg.weights, [key]: Math.round(v * 2) / 2 };
      }
    }
  }
  // Never end up with no source enabled.
  if (!cfg.srcIiwon && !cfg.srcIio) cfg.srcIiwon = true;
  return cfg;
}

module.exports = { DEFAULTS, encodeConfig, decodeConfig, normalizeConfig, DEFAULT_BASE_META };
