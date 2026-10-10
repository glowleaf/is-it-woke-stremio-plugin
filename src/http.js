'use strict';
// Catches things that would otherwise blow up inside a handler.
class UpstreamError extends Error {
  constructor(service, status, message) {
    super(`${service} ${status}: ${message}`);
    this.service = service;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT = 9000;

// GET a URL and parse JSON. Returns null on 404, throws UpstreamError otherwise.
async function getJson(url, { headers = {}, timeout = DEFAULT_TIMEOUT } = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...headers },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    throw new UpstreamError('fetch', 0, `${err.name === 'TimeoutError' ? 'timeout' : err.message} ${url}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error || body.message || message;
    } catch {
      /* not json */
    }
    throw new UpstreamError('http', res.status, `${message} ${url}`);
  }
  try {
    return await res.json();
  } catch {
    throw new UpstreamError('json', 0, `invalid JSON from ${url}`);
  }
}

const USER_AGENT = 'stremio-woke-score/1.1 (+https://isitwokeornot.com)';

// GET a URL and return the raw body as text (for pages that are not JSON).
async function getText(url, { headers = {}, timeout = DEFAULT_TIMEOUT } = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, ...headers },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    throw new UpstreamError('fetch', 0, `${err.name === 'TimeoutError' ? 'timeout' : err.message} ${url}`);
  }
  if (!res.ok) throw new UpstreamError('http', res.status, `${res.statusText} ${url}`);
  return res.text();
}

module.exports = { getJson, getText, UpstreamError, USER_AGENT };
