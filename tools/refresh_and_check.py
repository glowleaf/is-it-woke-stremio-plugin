#!/usr/bin/env python
"""Restart the app (so it re-fetches addon manifests - the earlier install grabbed the manifest
before the stream row existed), then verify the entry on a title page.
"""
import json
import sys
import time

from install_desktop_cdp import evaluate, find_page, restart_app, wait_for_page

TT = sys.argv[1] if len(sys.argv) > 1 else "tt1160419"


def main():
    restart_app()
    page = wait_for_page(90)
    if not page:
        print("no debug target after restart")
        return 1
    ws = page["webSocketDebuggerUrl"]
    print("order after restart:", evaluate(ws, """(() => {
      const p = JSON.parse(localStorage.getItem('profile') || '{}');
      const a = p.addons || [];
      const i = a.findIndex(x => x.manifest && x.manifest.id === 'community.woke.iiwon');
      const ours = i >= 0 ? a[i] : null;
      return JSON.stringify({ n: a.length, installed: i >= 0, index: i,
        resources: ours && ours.manifest ? (ours.manifest.resources || []).map(r => r.name) : null });
    })()"""))

    evaluate(ws, f"(() => {{ location.href = 'https://web.stremio.com/#/detail/movie/{TT}'; return 1; }})()")
    time.sleep(30)
    page = find_page() or page
    ws = page["webSocketDebuggerUrl"]
    text = evaluate(ws, "(() => (document.body.innerText || ''))()") or ""
    print("page len:", len(text))
    print("--- checks ---")
    for probe in ("Woke 39%", "Woke", "Slightly woke", "IS IT WOKE OR NOT?", "GENRES"):
        idx = text.find(probe)
        print(f"  {probe!r}: {'FOUND at ' + str(idx) if idx >= 0 else 'missing'}")
    idx = text.find("Woke")
    if idx >= 0:
        print("\ncontext:\n", text[max(0, idx - 200):idx + 300])
    else:
        print("\nlast 600 chars:\n", text[-600:])
    return 0


if __name__ == "__main__":
    sys.exit(main())
