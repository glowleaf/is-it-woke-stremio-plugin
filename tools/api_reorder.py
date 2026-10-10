#!/usr/bin/env python
"""Move the addon to the front of the collection through Stremio's own API, using the profile key
the desktop app already holds. That is authoritative - the app syncs the collection from
api.strem.io, which is why local writes kept reverting.
"""
import json
import sys
import time

from install_desktop_cdp import ADDON_URL, evaluate, find_page, port_is_open, restart_app

REORDER = """(async () => {
  const p = JSON.parse(localStorage.getItem('profile') || '{}');
  const authKey = p.auth && p.auth.key;
  if (!authKey) return JSON.stringify({ error: 'no profile key' });
  const call = async (method, body) => {
    const res = await fetch('https://api.strem.io/api/' + method, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return res.json();
  };
  const got = await call('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
  if (got.error) return JSON.stringify({ error: got.error.message || got.error });
  const addons = (got.result && got.result.addons) || [];
  if (!addons.length) return JSON.stringify({ error: 'empty collection from API' });
  const i = addons.findIndex(a => a.manifest && a.manifest.id === 'community.woke.iiwon');
  if (i < 0) return JSON.stringify({ error: 'addon not in the server collection', names: addons.map(a => a.manifest && a.manifest.name) });
  const [ours] = addons.splice(i, 1);
  try { ours.manifest = await (await fetch(%s, {cache:'no-store'})).json(); } catch (e) {}
  addons.unshift(ours);
  const set = await call('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons });
  const after = await call('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
  const out = (after.result && after.result.addons) || [];
  return JSON.stringify({
    setError: set.error ? (set.error.message || set.error) : null,
    count: out.length,
    first: out[0] && out[0].manifest && out[0].manifest.name,
    index: out.findIndex(a => a.manifest && a.manifest.id === 'community.woke.iiwon'),
    head: out.slice(0, 5).map(a => a.manifest && a.manifest.name),
  });
})()"""


def main():
    if not port_is_open():
        restart_app()
    page = find_page()
    if not page:
        print("no app page")
        return 1
    ws = page["webSocketDebuggerUrl"]
    print("reorder via api.strem.io:", evaluate(ws, REORDER % json.dumps(ADDON_URL), await_promise=True))

    evaluate(ws, "(() => { location.href = 'https://web.stremio.com/#/detail/movie/tt1160419'; return 1; })()")
    time.sleep(30)
    page = find_page() or page
    text = evaluate(page["webSocketDebuggerUrl"], "(() => (document.body.innerText||''))()") or ""
    print("\n--- Dune ---")
    for probe in ("39%", "Slightly woke", "IS IT WOKE OR NOT?", "GENRES"):
        idx = text.find(probe)
        print(f"  {probe!r}: {'FOUND at ' + str(idx) if idx >= 0 else 'missing'}")
    print("head:", text[:250].replace("\n", " | "))
    return 0


if __name__ == "__main__":
    sys.exit(main())
