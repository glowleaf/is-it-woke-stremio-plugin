#!/usr/bin/env python
"""Probe the Stremio desktop app: is the addon listed, and do the chips render?"""
import sys
import time

from install_desktop_cdp import evaluate, find_page


def main():
    page = find_page()
    if not page:
        print("no page target")
        return 1
    ws = page["webSocketDebuggerUrl"]

    print("reloading the app and opening its Addons page...")
    evaluate(ws, "(() => { location.hash = '#/addons'; location.reload(); return 1; })()")
    time.sleep(16)
    page = find_page() or page
    ws = page["webSocketDebuggerUrl"]
    text = evaluate(ws, "(() => (document.body.innerText || ''))()") or ""
    print("url:", evaluate(ws, "(() => location.href)()"))
    print("Woke Score listed in Addons:", "Woke Score" in text)
    idx = text.find("Woke Score")
    if idx >= 0:
        print("  ctx:", text[max(0, idx - 120):idx + 200].replace("\n", " | "))

    print("\nopening the Dune page...")
    evaluate(ws, "(() => { location.hash = '#/detail/movie/tt1160419'; return 1; })()")
    time.sleep(18)
    page = find_page() or page
    ws = page["webSocketDebuggerUrl"]
    text = evaluate(ws, "(() => (document.body.innerText || ''))()") or ""
    print(text[:900])
    print("\n--- chip check ---")
    for probe in ("IS IT WOKE OR NOT?", "Slightly woke", "WOKE FACTORS", "Woke representation", "still loading"):
        print(f"  {probe!r}: {'FOUND' if probe in text else 'missing'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
