#!/usr/bin/env python
"""Reload the app so it pulls the new collection order from Stremio's API, then verify Dune."""
import sys
import time

from install_desktop_cdp import evaluate, find_page, port_is_open, restart_app


def main():
    if not port_is_open():
        restart_app()
        time.sleep(10)
    page = find_page()
    if not page:
        print("no app page")
        return 1
    ws = page["webSocketDebuggerUrl"]

    evaluate(ws, "(() => { location.href = 'https://web.stremio.com/#/'; return 1; })()")
    time.sleep(22)
    page = find_page() or page
    ws = page["webSocketDebuggerUrl"]
    print("collection in app:", evaluate(ws, """(() => { const p = JSON.parse(localStorage.getItem('profile')||'{}'); const a = p.addons||[]; return JSON.stringify({first:a[0]&&a[0].manifest&&a[0].manifest.name, idx:a.findIndex(x=>x.manifest&&x.manifest.id==='community.woke.iiwon')}); })()"""))

    evaluate(ws, "(() => { location.href = 'https://web.stremio.com/#/detail/movie/tt1160419'; return 1; })()")
    time.sleep(28)
    page = find_page() or page
    text = evaluate(page["webSocketDebuggerUrl"], "(() => (document.body.innerText||''))()") or ""
    print("\n--- Dune ---")
    for probe in ("39%", "Slightly woke", "IS IT WOKE OR NOT?", "WOKE FACTORS", "GENRES"):
        idx = text.find(probe)
        print(f"  {probe!r}: {'FOUND at ' + str(idx) if idx >= 0 else 'missing'}")
    print("\nhead:", text[:300].replace("\n", " | "))
    return 0


if __name__ == "__main__":
    sys.exit(main())
