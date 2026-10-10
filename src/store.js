'use strict';
// Tiny persistent key/value store with TTLs, shared by all users of the addon.
// Used for three namespaces:
//   m:<type>:<id>   Cinemeta base metadata (TTL)
//   t:<slug>        isitwokeornot title detail (TTL)
//   s:<query>       isitwokeornot search result (TTL)
//   idx:<imdbId>    permanent imdbId -> site title mapping (no expiry)

const fs = require('node:fs');
const path = require('node:path');

class Store {
  constructor(file, { maxEntries = 40000, flushMs = 2000 } = {}) {
    this.file = file;
    this.maxEntries = maxEntries;
    this.flushMs = flushMs;
    this.map = new Map();
    this.dirty = false;
    this.timer = null;
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const now = Date.now();
      for (const [k, v] of Object.entries(raw)) {
        if (!v || (v.exp && v.exp < now)) continue;
        this.map.set(k, v);
      }
      console.log(`[store] loaded ${this.map.size} entries from ${this.file}`);
    } catch {
      /* first run */
    }
  }

  get(key) {
    const rec = this.map.get(key);
    if (!rec) return undefined;
    if (rec.exp && rec.exp < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return rec.v;
  }

  set(key, value, ttlMs = 0) {
    if (this.map.size >= this.maxEntries) this.evict();
    this.map.set(key, { v: value, exp: ttlMs ? Date.now() + ttlMs : 0 });
    this.schedule();
  }

  // Drop expired entries first, then the oldest half if we are still over budget.
  evict() {
    const now = Date.now();
    for (const [k, rec] of this.map) if (rec.exp && rec.exp < now) this.map.delete(k);
    if (this.map.size < this.maxEntries) return;
    const half = Math.floor(this.map.size / 2);
    let i = 0;
    for (const k of this.map.keys()) {
      this.map.delete(k);
      if (++i >= half) break;
    }
  }

  schedule() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.flushMs);
    if (this.timer.unref) this.timer.unref();
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const obj = {};
      for (const [k, v] of this.map) obj[k] = v;
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(obj));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.warn(`[store] flush failed: ${err.message}`);
    }
  }
}

module.exports = { Store };
