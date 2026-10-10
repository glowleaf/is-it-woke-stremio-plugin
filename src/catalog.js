'use strict';
// Browse catalogs, served from a local index of the site's catalogue.
//
// The index is built by tools/prime_index.js (walks the public list + detail endpoints and
// records imdbId, name, year, type, score, poster). Catalog items use the real IMDb id as
// their id, so opening one lands on the normal Cinemeta detail page - with our chips on it.

const fs = require('node:fs');
const path = require('node:path');

const CATALOGS = [
  { id: 'iiwon-least-woke', order: 'asc', name: 'Least Woke' },
  { id: 'iiwon-most-woke', order: 'desc', name: 'Most Woke' },
];

class Index {
  constructor(file) {
    this.file = file;
    this.rows = [];
    this.loadedAt = 0;
    this.load();
    // Pick up a freshly primed index without needing a restart.
    setInterval(() => this.reloadIfChanged(), 5 * 60 * 1000).unref();
  }

  load() {
    try {
      const stat = fs.statSync(this.file);
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const rows = Array.isArray(raw) ? raw : Object.values(raw);
      this.rows = rows.filter(
        (r) => r && r.imdbId && /^tt\d+$/.test(r.imdbId) && Number.isFinite(r.score) && r.name,
      );
      this.loadedAt = stat.mtimeMs;
      console.log(`[index] ${this.rows.length} titles from ${this.file}`);
    } catch {
      this.rows = [];
    }
  }

  reloadIfChanged() {
    try {
      const stat = fs.statSync(this.file);
      if (stat.mtimeMs !== this.loadedAt) this.load();
    } catch {
      /* no index yet */
    }
  }

  get size() {
    return this.rows.length;
  }

  query({ order = 'asc', skip = 0, limit = 100, type, minYear, maxYear }) {
    const siteType = type === 'series' ? 'TV_SHOW' : 'MOVIE';
    let rows = this.rows.filter((r) => r.type === siteType);
    if (minYear) rows = rows.filter((r) => r.year && r.year >= minYear);
    if (maxYear) rows = rows.filter((r) => r.year && r.year <= maxYear);
    rows.sort((a, b) => (order === 'desc' ? b.score - a.score : a.score - b.score) || a.name.localeCompare(b.name));
    return rows.slice(skip, skip + limit);
  }
}

function toCatalogMeta(row, type) {
  const meta = {
    id: row.imdbId,
    type,
    name: row.name,
    posterShape: 'poster',
    releaseInfo: row.year ? String(row.year) : undefined,
    description: `Woke Score ${Math.round(row.score)}%${row.band ? ` · ${row.band}` : ''}`,
  };
  if (row.poster) meta.poster = row.poster;
  for (const k of Object.keys(meta)) if (meta[k] === undefined) delete meta[k];
  return meta;
}

module.exports = { Index, CATALOGS, toCatalogMeta };
