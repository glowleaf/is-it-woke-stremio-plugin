#!/usr/bin/env python
"""Put the addon at the front of the Stremio desktop app's collection and confirm the write sticks.

The app keeps its collection in localStorage['profile']; it persists that on changes, so a write
made while it is running can be clobbered seconds later. This writes, verifies immediately, waits,
verifies again, and (if needed) quits the app so nothing overwrites the value before it restarts.
"""
import json
import subprocess
import sys
import time

from install_desktop_cdp import evaluate, find_page

ADDON_ID = "community.woke.iiwon"
ADDON_URL = "https://relay.loveisbitcoin.com/woke/e30/manifest.json"

WRITE = """(async () => {
  const id = %s, url = %s;
  const raw = localStorage.getItem('profile');
  if (!raw) return JSON.stringify({error: 'no profile'});
  const p = JSON.parse(raw);
  const addons = p.addons || [];
  const i = addons.findIndex(a => a.manifest && a.manifest.id === id);
  let entry;
  if (i >= 0) { entry = addons.splice(i, 1)[0]; }
  else {
    const manifest = await (await fetch(url, {cache: 'no-store'})).json();
    entry = { manifest, transportUrl: url, transportName: 'Woke Score', flags: { official: false, protected: false } };
  }
  addons.unshift(entry);
  p.addons = addons;
  localStorage.setItem('profile', JSON.stringify(p));
  const back = JSON.parse(localStorage.getItem('profile'));
  return JSON.stringify({ wrote: back.addons.length, first: back.addons[0].manifest.name, order: back.addons.map(a => a.manifest.name).slice(0, 5) });
})()"""

ORDER = "(() => { const p = JSON.parse(localStorage.getItem('profile') || '{}'); const a = p.addons || []; return JSON.stringify({n: a.length, first: a[0] && a[0].manifest && a[0].manifest.name}); })()"


def main():
    page = find_page()
    if not page:
        print("no page target")
        return 1
    ws = page["webSocketDebuggerUrl"]

    print("write:", evaluate(ws, WRITE % (json.dumps(ADDON_ID), json.dumps(ADDON_URL)), await_promise=True))
    time.sleep(6)
    after = evaluate(ws, ORDER)
    print("6s later:", after)
    if "Woke" not in (after or ""):
        print("the running app clobbered the write -> quitting it so the value survives")
        for image in ("stremio-shell-ng.exe", "stremio-runtime.exe"):
            subprocess.run(["taskkill", "/F", "/IM", image], capture_output=True)
        print("app closed; relaunch it (or run tools/install_desktop_cdp.py to relaunch with the port)")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
