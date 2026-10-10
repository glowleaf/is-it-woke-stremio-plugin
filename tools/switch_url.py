#!/usr/bin/env python
"""Point the installed addon at the greekai.gr URL (keeping it first in the collection), then
verify the app renders from it."""
import json
import sys
import time

from install_desktop_cdp import evaluate, find_page, port_is_open, restart_app

NEW_URL = "https://scrut.greekai.gr/woke/e30/manifest.json"

SWITCH = """(async () => {
  const newUrl = %s;
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
  const i = addons.findIndex(a => a.manifest && a.manifest.id === 'community.woke.iiwon');
  if (i < 0) return JSON.stringify({ error: 'not installed' });
  const [ours] = addons.splice(i, 1);
  ours.transportUrl = newUrl;
  ours.manifest = await (await fetch(newUrl, { cache: 'no-store' })).json();
  addons.unshift(ours);
  const set = await call('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons });
  const after = await call('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
  const out = (after.result && after.result.addons) || [];
  return JSON.stringify({
    setError: set.error ? (set.error.message || set.error) : null,
    first: out[0] && out[0].manifest && out[0].manifest.name,
    url: out[0] && out[0].transportUrl,
    host: out[0] && out[0].transportUrl,
    count: out.length,
  });
})()"""


def main():
    if not port_is_open():
        restart_app()
        time.sleep(10)
    page = find_page()
    if not page:
        print("no app page")
        return 1
    ws = page["webSocketDebuggerUrl"]
    print("switch:", evaluate(ws, SWITCH % json.dumps(NEW_URL), await_promise=True))

    evaluate(ws, "(() => { location.href = 'https://web.stremio.com/#/detail/movie/tt1160419'; return 1; })()")
    time.sleep(30)
    page = find_page() or page
    text = evaluate(page["webSocketDebuggerUrl"], "(() => (document.body.innerText||''))()") or ""
    print("\n--- Dune ---")
    for probe in ("Is It Woke or Not? 39%", "isitwoke.io 21%", "WOKE", "GENRES"):
        idx = text.find(probe)
        print(f"  {probe!r}: {'FOUND at ' + str(idx) if idx >= 0 else 'missing'}")
    print("head:", text[:230].replace("\n", " | "))
    return 0


if __name__ == "__main__":
    sys.exit(main())
