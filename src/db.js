'use strict';
// SQLite storage for woke scores: every title is looked up on the two sites ONCE, then served
// from here forever. One row per (title, source), keyed by the IMDb id, so a title open that has
// already been resolved costs zero upstream requests.
//
// Table:
//   key        IMDb id the Stremio client asked for (or "<type>:<tmdb id>" when there is none)
//   source     'iiwon' (isitwokeornot.com) | 'iio' (isitwoke.io)
//   status     'ok' (a score was stored) | 'missing' (the site does not cover this title)
//   score      the score as stored by the site (0-100)
//   label      verdict band / verdict label
//   payload    full JSON of the stored rating, used to rebuild the response offline

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SOURCES = ['iiwon', 'iio'];

class ScoreDB {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS woke_scores (
        key        TEXT NOT NULL,
        source     TEXT NOT NULL,
        status     TEXT NOT NULL,
        score      INTEGER,
        label      TEXT,
        payload    TEXT,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (key, source)
      );
      CREATE INDEX IF NOT EXISTS idx_woke_fetched ON woke_scores (fetched_at);
    `);
    this.getStmt = this.db.prepare('SELECT source, status, payload, fetched_at FROM woke_scores WHERE key = ?');
    this.putStmt = this.db.prepare(`
      INSERT INTO woke_scores (key, source, status, score, label, payload, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key, source) DO UPDATE SET
        status = excluded.status, score = excluded.score, label = excluded.label,
        payload = excluded.payload, fetched_at = excluded.fetched_at
    `);
    this.statsStmt = this.db.prepare('SELECT COUNT(*) rows, COUNT(DISTINCT key) titles, MIN(fetched_at) first, MAX(fetched_at) last FROM woke_scores');
  }

  // { iiwon: {status, payload} | undefined, iio: {...} } - undefined when never looked up.
  // A stored row is final: 'missing' rows are kept too, so a title the sites do not cover is
  // never queried again either.
  lookup(key) {
    if (!key) return {};
    const out = {};
    for (const row of this.getStmt.all(key)) {
      let payload = null;
      if (row.status === 'ok' && row.payload) {
        try {
          payload = JSON.parse(row.payload);
        } catch {
          continue; // corrupt row: treat as not cached
        }
      }
      out[row.source] = { status: row.status, payload, fetchedAt: row.fetched_at };
    }
    return out;
  }

  // status: 'ok' with a rating object, or 'missing'.
  save(key, source, status, rating) {
    if (!key || !SOURCES.includes(source)) return;
    const score = rating && typeof rating.score === 'number' ? Math.round(rating.score) : null;
    const label = rating ? (rating.band && rating.band.label) || rating.verdictLabel || null : null;
    const payload = rating ? JSON.stringify(rating) : null;
    this.putStmt.run(key, source, status, score, label, payload, Date.now());
  }

  stats() {
    try {
      const row = this.statsStmt.get();
      return { titles: row.titles || 0, rows: row.rows || 0 };
    } catch {
      return { titles: 0, rows: 0 };
    }
  }

  close() {
    try {
      this.db.close();
    } catch {
      /* ignore */
    }
  }
}

module.exports = { ScoreDB, SOURCES };
