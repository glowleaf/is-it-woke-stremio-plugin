#!/usr/bin/env python
"""Put the addon first in the app's collection, quit the app immediately (so nothing overwrites
the stored value), relaunch, and verify the Dune page shows the badge + chip rows."""
import json
import subprocess
import sys
import time

from install_desktop_cdp import ADDON_URL, evaluate, http_json, port_is_open, restart_app


def app_page(seconds=150):
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            for t in http_json("/json/list"):
                if t.get("type") == "page" and "stremio.com" in (t.get("url") or ""):
                    return t
        except Exception:
            pass
        time.sleep(3)
    return None


def order(ws):
    return evaluate(ws, """(() => { const p = JSON.parse(localStorage.getItem('profile')||'{}'); const a = p.addons||[]; const i = a.findIndex(x=>x.manifest && x.manifest.id==='community.woke.iiwon'); return JSON.stringify({n:a.length, index:i, first:a[0]&&a[0].manifest&&a[0].manifest.name, resources: i>=0?(a[i].manifest.resources||[]).map(r=>r.name):null}); })()""")


def main():
    if not port_is_open():
        restart_app()
    page = app_page()
    if not page:
        print("no app page")
        return 1
    ws = page["webSocketDebuggerUrl"]
    print("before:", order(ws))

    print("write:", evaluate(ws, """(async () => {
      const id = 'community.woke.iiwon', url = %s;
      const p = JSON.parse(localStorage.getItem('profile') || '{}');
      const a = p.addons || [];
      const i = a.findIndex(x => x.manifest && x.manifest.id === id);
      if (i < 0) return 'not installed';
      const [ours] = a.splice(i, 1);
      // refresh the snapshot too, so the manifest always matches the server
      try { ours.manifest = await (await fetch(url, {cache:'no-store'})).json(); } catch (e) {}
      a.unshift(ours);
      p.addons = a;
      localStorage.setItem('profile', JSON.stringify(p));
      return 'moved to front';
    })()""" % json.dumps(ADDON_URL), await_promise=True))
    print("immediately after write:", order(ws))

    # Quit at once so the app cannot save its in-memory order over ours.
    for image in ("stremio-shell-ng.exe", "stremio-runtime.exe"):
        subprocess.run(["taskkill", "/F", "/IM", image], capture_output=True)
    print("app killed")
    time.sleep(4)

    restart_app()
    page = app_page()
    if not page:
        print("app did not come back with the port")
        return 1
    ws = page["webSocketDebuggerUrl"]
    time.sleep(6)
    print("after relaunch:", order(ws))

    evaluate(ws, "(() => { location.href = 'https://web.stremio.com/#/detail/movie/tt1160419'; return 1; })()")
    time.sleep(32)
    page = app_page(30) or page
    text = evaluate(page["webSocketDebuggerUrl"], "(() => (document.body.innerText||''))()") or ""
    print("\n--- Dune ---")
    for probe in ("39%", "Woke", "Slightly woke", "8.0"):
        idx = text.find(probe)
        print(f"  {probe!r}: {'FOUND at ' + str(idx) if idx >= 0 else 'missing'}")
    print("\nhead:\n", text[:260])
    return 0


if __name__ == "__main__":
    sys.exit(main())
