'use strict';
// Turns the resolved ratings into Stremio `links` rows.
//
// Stremio renders every entry of `meta.links` whose category is not `imdb`, `share` or
// `Writers` as a titled row of clickable chips, using the same component as Genres/Cast.
// That is the only way an addon can put text on the detail page (there is no custom-HTML
// hook). Chip labels must not contain ':' - Stremio runs them through i18next.
//
// One row per source, so the two sites never get mixed up:
//   Is It Woke or Not?       -> 🟨 Slightly woke 39%      +  ↗ Review
//   Is It Woke (isitwoke.io) -> ⬛ Certified Woke Trash 82% +  ↗ Analysis

const { pageUrl, searchUrl, markerForStep, MARKER_STEPS, bandOf } = require('./iiwon');
const iio = require('./isitwokeio');
const { EXTRA_SOURCES } = require('./extra');

const IIO_HOME = 'https://isitwoke.io/';
// Where the aggregate chip points: the write-up that explains what the number is.
const OVERALL_LINK = 'https://georgesaoulidis.com/woke-score-stremio-addon/';

// Mean of the sources that have a score, plus how far apart they are. Metacritic-style: one
// headline number, with the spread only shown when the two sites actually disagree.
function aggregate(results, method = 'mean') {
  const scores = [];
  for (const key of ['iiwon', 'iio', ...EXTRA_SOURCES.map((s) => s.key)]) {
    const r = results[key];
    if (r && typeof r.score === 'number') scores.push(Math.round(r.score));
  }
  if (scores.length < 2) return null; // one source only: an aggregate would just repeat it
  const sorted = scores.slice().sort((a, b) => a - b);
  let avg;
  if (method === 'median') {
    const mid = Math.floor(sorted.length / 2);
    avg = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  } else {
    avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }
  return { avg, spread: sorted[sorted.length - 1] - sorted[0], n: sorted.length, method, scores: sorted };
}

function chip(step, label, pct, cfg) {
  const mark = step === null || step === undefined ? '' : markerForStep(step, cfg.markers);
  const parts = [];
  if (mark) parts.push(mark);
  if (cfg.band && label) parts.push(label);
  parts.push(pct);
  return parts.join(' ');
}

// Combined-row chip: always carries the source name, so one row can hold both sources.
function chipWithSource(step, source, pct, cfg) {
  const mark = step === null || step === undefined ? '' : markerForStep(step, cfg.markers);
  return [mark, source, pct].filter(Boolean).join(' ');
}

// results: { iiwon: title|null|undefined, iio: rating|null|undefined }
// undefined = that source is switched off (no row at all); null = on but nothing found.
function decorateMeta(base, results, cfg) {
  const meta = { ...base };
  const rows = [];
  const SHORT_A = 'Is It Woke or Not?';
  const SHORT_B = 'isitwoke.io';

  // Combined: ONE row, both scores, each chip linking to its own source page.
  if (cfg.combine) {
    const chips = [];
    const agg = aggregate(results, cfg.aggregateMethod);
    if (cfg.overall && agg) {
      // same colour scale as the source chips, so the headline number has a meter too
      const aggBand = bandOf(agg.avg);
      const aggMark = aggBand ? `${markerForStep(aggBand.step, cfg.markers)} ` : '';
      chips.push({
        name: `${aggMark}Overall ${agg.avg}%${agg.spread ? ` (±${agg.spread})` : ''}`,
        url: OVERALL_LINK,
      });
    }
    if (results.iiwon !== undefined) {
      if (results.iiwon) {
        chips.push({
          name: chipWithSource(results.iiwon.band ? results.iiwon.band.step : null, SHORT_A, `${Math.round(results.iiwon.score)}%`, cfg),
          url: pageUrl(results.iiwon),
        });
      } else if (cfg.missing) {
        chips.push({ name: `${SHORT_A} — not reviewed`, url: searchUrl((base && base.name) || '') });
      }
    }
    if (results.iio !== undefined) {
      if (results.iio) {
        chips.push({
          name: chipWithSource(results.iio.band ? results.iio.band.step : null, SHORT_B, `${Math.round(results.iio.score)}%`, cfg),
          url: iio.pageUrl(results.iio.type, results.iio.tmdbId),
        });
      } else if (cfg.missing) {
        chips.push({ name: `${SHORT_B} — not rated`, url: IIO_HOME });
      }
    }
    // extra sources (0-10 sites normalised to 0-100), same row
    for (const src of EXTRA_SOURCES) {
      const r = results[src.key];
      if (r === undefined) continue;
      if (r) {
        chips.push({
          name: chipWithSource(r.score != null ? (bandOf(r.score) || {}).step : null, src.short, `${Math.round(r.score)}%`, cfg),
          url: r.url || OVERALL_LINK,
        });
      } else if (cfg.missing) {
        chips.push({ name: `${src.short} — not rated`, url: OVERALL_LINK });
      }
    }
    // Nothing scored it anywhere? Then there is no row to show.
    if (chips.length) rows.push({ category: cfg.combinedTitle, chips });
  }

  if (!cfg.combine && results.iiwon !== undefined) {
    const title = results.iiwon;
    const chips = [];
    if (title) {
      const url = pageUrl(title);
      chips.push({
        name: chip(title.band ? title.band.step : null, title.band ? title.band.label : '', `${Math.round(title.score)}%`, cfg),
        url,
      });
      if (cfg.link) chips.push({ name: '↗ Review', url });
    } else if (cfg.missing) {
      chips.push({ name: '— not reviewed', url: searchUrl((base && base.name) || '') });
    }
    if (chips.length) rows.push({ category: cfg.titleA, chips });
  }

  if (!cfg.combine && results.iio !== undefined) {
    const rating = results.iio;
    const chips = [];
    if (rating) {
      const url = iio.pageUrl(rating.type, rating.tmdbId);
      chips.push({
        name: chip(
          rating.band ? rating.band.step : null,
          rating.band ? rating.band.label : rating.verdictLabel,
          `${Math.round(rating.score)}%`,
          cfg,
        ),
        url,
      });
      if (cfg.link) chips.push({ name: '↗ Analysis', url });
    } else if (cfg.missing) {
      chips.push({ name: '— not rated', url: IIO_HOME });
    }
    if (chips.length) rows.push({ category: cfg.titleB, chips });
  }

  if (cfg.factors && results.iiwon && results.iiwon.factors && results.iiwon.factors.length) {
    const url = pageUrl(results.iiwon);
    rows.push({
      category: 'Woke factors',
      chips: results.iiwon.factors.slice(0, 3).map((f) => ({ name: f.label, url })),
    });
  }

  const ours = [];
  for (const row of rows) {
    for (const c of row.chips) ours.push({ name: c.name, category: row.category, url: c.url });
  }

  if (cfg.description) {
    const lines = [];
    // Same colour scale the chip row uses (green -> yellow -> orange -> red -> black), so the
    // meter is readable at a glance on a phone.
    const mark = (score) => {
      const band = bandOf(score);
      return band ? `${markerForStep(band.step, cfg.markers)} ` : '';
    };
    const aggDesc = aggregate(results, cfg.aggregateMethod);
    if (cfg.overall && aggDesc) lines.push(`${mark(aggDesc.avg)}Overall ${aggDesc.avg}%${aggDesc.spread ? ` (±${aggDesc.spread})` : ''}`);
    if (results.iiwon) lines.push(`${mark(results.iiwon.score)}${cfg.titleA} ${Math.round(results.iiwon.score)}%`);
    if (results.iio) lines.push(`${mark(results.iio.score)}${cfg.titleB} ${Math.round(results.iio.score)}%`);
    for (const src of EXTRA_SOURCES) {
      const r = results[src.key];
      if (r && typeof r.score === 'number') lines.push(`${mark(r.score)}${src.short} ${Math.round(r.score)}%`);
    }
    if (lines.length) {
      // Prepend only: the synopsis the metadata addon returned stays exactly as it was - no
      // analysis text mixed in, so on a phone the first lines are the score and then the synopsis.
      meta.description = `Woke: ${lines.join(' · ')}\n\n${meta.description || ''}`.trim();
    }
  }

  // Optional: put the score inside the IMDb badge in the header row (the `53 min | 2006 | 8.6 [IMDb]`
  // line). Per stremio-web's MetaPreview.js that badge renders the label of the `imdb`-category
  // link (only when it points at imdb.com), so the label is ours to extend - and it is the only
  // addon-controlled slot in that row.
  let imdbPatched = null;
  if (cfg.imdbBadge) {
    const shown = results.iiwon || results.iio;
    if (shown) {
      const existingImdb = (Array.isArray(base.links) ? base.links : []).find((l) => l && l.category === 'imdb');
      const imdbValue = existingImdb ? existingImdb.name : base.imdbRating ? String(base.imdbRating) : '';
      const mark = markerForStep(shown.band ? shown.band.step : null, cfg.markers);
      const scoreBit = `${mark ? `${mark} ` : ''}${Math.round(shown.score)}%`;
      const label = imdbValue ? `${imdbValue}  ·  ${scoreBit}` : scoreBit;
      const imdbUrl = existingImdb && existingImdb.url && existingImdb.url.includes('imdb.com')
        ? existingImdb.url
        : `https://www.imdb.com/title/${base.id}/`;
      imdbPatched = { name: label, category: 'imdb', url: imdbUrl };
    }
  }

  // Copy: `base` comes from the cache and must not be mutated.
  let existing = Array.isArray(meta.links) ? meta.links.map((l) => ({ ...l })) : [];
  if (imdbPatched) {
    existing = existing.filter((l) => l.category !== 'imdb');
    existing.push(imdbPatched);
  }
  meta.links = cfg.placement === 'top' ? [...ours, ...existing] : [...existing, ...ours];
  return meta;
}

// Entry at the top of the stream list. This is the one channel that works for EVERYBODY: streams
// from all installed addons are merged, so it shows regardless of the addon order or the account -
// no need for the user to put this addon above Cinemeta (which phone/TV clients cannot do at all).
function buildStream(results, cfg) {
  const agg = aggregate(results, cfg.aggregateMethod);
  const mark = (score) => {
    const band = bandOf(score);
    return band ? `${markerForStep(band.step, cfg.markers)} ` : '';
  };
  const lines = [];
  if (cfg.overall && agg) lines.push(`${mark(agg.avg)}Overall ${agg.avg}%${agg.spread ? ` (±${agg.spread})` : ''}`);
  if (results.iiwon) lines.push(`${mark(results.iiwon.score)}${cfg.titleA} ${Math.round(results.iiwon.score)}%`);
  if (results.iio) lines.push(`${mark(results.iio.score)}${cfg.titleB} ${Math.round(results.iio.score)}%`);
  for (const src of EXTRA_SOURCES) {
    const r = results[src.key];
    if (r && typeof r.score === 'number') lines.push(`${mark(r.score)}${src.short} ${Math.round(r.score)}%`);
  }
  if (!lines.length) return null;
  const body = lines.join('\n');
  const headline = cfg.overall && agg ? `${mark(agg.avg)}Woke ${agg.avg}%` : lines[0];
  // NB: no `description` field. stremio-core deserialises streams strictly and older builds have no
  // `description` on Stream (it is the newer name for `title`), which makes the WHOLE response fail to
  // parse - the client then shows nothing at all, silently. `title` is understood by every version.
  return {
    name: headline,
    title: body,
    externalUrl: OVERALL_LINK,
  };
}

module.exports = { decorateMeta, buildStream, chip, MARKER_STEPS };
