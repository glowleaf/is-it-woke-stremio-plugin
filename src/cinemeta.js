'use strict';
// Base metadata provider (Cinemeta by default). Addons cannot invent the detail page: the
// page is built from whichever meta addon answers first, so we take Cinemeta's answer and
// decorate it with our extra rows. If this fails we return 404 and Stremio falls through.

const { getJson } = require('./http');

const BASE_TTL = 12 * 60 * 60 * 1000;
const MANIFEST_TTL = 6 * 60 * 60 * 1000;

async function fetchBaseMeta(baseUrl, type, id, store) {
  const key = `m:${type}:${id}`;
  const cached = store.get(key);
  if (cached) return cached;
  const url = `${baseUrl.replace(/\/+$/, '')}/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
  const data = await getJson(url);
  const meta = data && data.meta ? data.meta : null;
  if (meta) store.set(key, meta, BASE_TTL);
  return meta;
}

// Mirror the base addon's catalog list, so this addon can serve exactly the same board rows and
// search. Needed when it has to stand in for the official metadata addon (it cannot lose the
// "first meta addon wins" race if it *is* the metadata addon).
async function fetchCatalogList(baseUrl, store) {
  const key = 'cm:catalogs';
  const cached = store.get(key);
  if (cached) return cached;
  const url = `${baseUrl.replace(/\/+$/, '')}/manifest.json`;
  const data = await getJson(url);
  const catalogs = data && Array.isArray(data.catalogs) ? data.catalogs : [];
  if (catalogs.length) store.set(key, catalogs, MANIFEST_TTL);
  return catalogs;
}

// Proxy one catalog request straight through to the base addon.
async function proxyCatalog(baseUrl, type, id, extra) {
  const suffix = Object.entries(extra || {})
    .map(([k, val]) => `${k}=${encodeURIComponent(val)}`)
    .join('&');
  const url = `${baseUrl.replace(/\/+$/, '')}/catalog/${encodeURIComponent(type)}/${encodeURIComponent(id)}${suffix ? `/${suffix}` : ''}.json`;
  const data = await getJson(url);
  return data && Array.isArray(data.metas) ? data.metas : [];
}

module.exports = { fetchBaseMeta, fetchCatalogList, proxyCatalog };
