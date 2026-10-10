#!/usr/bin/env python
"""Read back what the Stremio desktop app renders (needs tools/install_desktop_cdp.py to have
opened the debug port). Prints the stored addon order and whether the chips are on the page.

Run:  python tools/verify_desktop.py [tt-id]
"""
import json
import sys
import time

from install_desktop_cdp import evaluate, find_page  # noqa: E402  (same folder)

TT = sys.argv[1] if len(sys.argv) > 1 else "tt1160419"


def main():
    page = find_page()
    if not page:
        print("no page target - is the app running with the debug port?")
        return 1
    ws = page["webSocketDebuggerUrl"]

    order = evaluate(ws, """(() => {
      try {
        const p = JSON.parse(localStorage.getItem('profile') || '{}');
        return JSON.stringify((p.addons || []).map(a => (a.manifest || {}).name));
      } catch (e) { return 'ERR ' + e.message; }
    })()""")
    print("addon order in the app:", order)

    evaluate(ws, f"(() => {{ location.hash = '#/detail/movie/{TT}'; if (!location.hash.includes('detail')) return 'hash failed'; location.reload(); return 'ok'; }})()")
    time.sleep(20)
    page = find_page() or page
    text = evaluate(page["webSocketDebuggerUrl"], "(() => (document.body.innerText || ''))()") or ""
    print("\n--- first 500 chars of the page ---")
    print(text[:500])

    print("\n--- chip check ---")
    for probe in ("IS IT WOKE OR NOT?", "Slightly woke", "WOKE FACTORS", "isitwoke.io", "Woke representation"):
        idx = text.find(probe)
        print(f"  {probe!r}: {'found at ' + str(idx) if idx >= 0 else 'MISSING'}")
        if idx > 0:
            print("      ctx:", text[max(0, idx - 60):idx + 120].replace("\n", " | "))
    return 0


if __name__ == "__main__":
    sys.exit(main())
