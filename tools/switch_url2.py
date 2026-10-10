#!/usr/bin/env python
"""Point the addon at a fresh (cache-busting) config path on the greekai.gr URL, keep it first,
and verify the app now renders the combined row."""
import sys
import time

from install_desktop_cdp import evaluate, find_page, port_is_open, restart_app

SWITCH = """(async () => {
  const base = 'https://scrut.greekai.gr/woke/';
  // A new config segment = new request URLs = the client cannot reuse its cached responses.
  const cfg = btoa(JSON.stringify({ v: 2 })).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  const newUrl = base + cfg + '/manifest.json';
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
  await call('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons });
  return JSON.stringify({ url: newUrl, first: addons[0].manifest.name, count: addons.length });
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
    print("switch:", evaluate(ws, SWITCH, await_promise=True))

    evaluate(ws, "(() => { location.reload(); return 1; })()")
    time.sleep(18)
    page = find_page() or page
    ws = page["webSocketDebuggerUrl"]
    evaluate(ws, "(() => { location.href = 'https://web.stremio.com/#/detail/movie/tt1160419'; return 1; })()")
    time.sleep(28)
    page = find_page() or page
    text = evaluate(page["webSocketDebuggerUrl"], "(() => (document.body.innerText||''))()") or ""
    print("\n--- Dune ---")
    for probe in ("WOKE SCORE", "Is It Woke or Not? 39%", "isitwoke.io 21%", "8.0 · "):
        idx = text.find(probe)
        print(f"  {probe!r}: {'FOUND' if idx >= 0 else 'missing'}")
    print("head:", text[:240].replace("\n", " | "))
    return 0


if __name__ == "__main__":
    sys.exit(main())
