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

const { pageUrl, searchUrl, markerForStep, MARKER_STEPS } = require('./iiwon');
const iio = require('./isitwokeio');

const IIO_HOME = 'https://isitwoke.io/';

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
    rows.push({ category: cfg.combinedTitle, chips });
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
    rows.push({ category: cfg.titleA, chips });
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
    rows.push({ category: cfg.titleB, chips });
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
    if (results.iiwon) {
      const band = results.iiwon.band ? ` (${results.iiwon.band.label.toLowerCase()})` : '';
      lines.push(`${cfg.titleA} - ${Math.round(results.iiwon.score)}%${band}`);
    }
    if (results.iio) {
      lines.push(`${cfg.titleB} - ${Math.round(results.iio.score)}% (${results.iio.verdictLabel})`);
    }
    if (lines.length) {
      const summary =
        results.iio && results.iio.reasons && results.iio.reasons.length
          ? `${results.iio.reasons[0]}\n\n`
          : results.iiwon && results.iiwon.summary
            ? `${results.iiwon.summary}\n\n`
            : '';
      meta.description = `${lines.join('\n')}\n\n${summary}${meta.description || ''}`.trim();
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

// Optional single entry at the top of the stream list (the same trick the original Ratings
// addon uses). Streams are aggregated from every installed addon, so this entry shows up
// whether or not this addon is first in the list.
function buildStream(results, cfg) {
  const lines = [];
  if (results.iiwon) {
    const band = results.iiwon.band ? ` (${results.iiwon.band.label})` : '';
    lines.push(`${cfg.titleA}: ${Math.round(results.iiwon.score)}%${band}`);
  }
  if (results.iio) lines.push(`${cfg.titleB}: ${Math.round(results.iio.score)}% (${results.iio.verdictLabel})`);
  if (!lines.length) return null;
  const body = lines.join('\n');
  const externalUrl = results.iiwon
    ? pageUrl(results.iiwon)
    : iio.pageUrl(results.iio.type, results.iio.tmdbId);
  const score = results.iiwon ? results.iiwon.score : results.iio.score;
  const band = results.iiwon && results.iiwon.band ? ` - ${results.iiwon.band.label}` : '';
  return {
    name: `Woke ${Math.round(score)}%${band}`,
    description: body,
    title: body,
    externalUrl,
  };
}

module.exports = { decorateMeta, buildStream, chip, MARKER_STEPS };
