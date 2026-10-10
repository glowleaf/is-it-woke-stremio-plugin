#!/usr/bin/env python
"""Check the stream list on a title page for the Woke Score entry."""
import sys
import time

from install_desktop_cdp import evaluate, find_page, wait_for_page

TT = sys.argv[1] if len(sys.argv) > 1 else "tt1160419"
TYPE = sys.argv[2] if len(sys.argv) > 2 else "movie"


def main():
    page = wait_for_page(60)
    if not page:
        print("no debug target")
        return 1
    print("target:", page.get("url"))
    ws = page["webSocketDebuggerUrl"]
    print("current url:", evaluate(ws, "(() => location.href.slice(0, 90))()"))

    evaluate(ws, f"(() => {{ location.hash = '#/detail/{TYPE}/{TT}'; return 1; }})()")
    time.sleep(30)
    page = find_page() or page
    text = evaluate(page["webSocketDebuggerUrl"], "(() => (document.body.innerText || ''))()") or ""
    print("\npage length:", len(text))
    print("--- head ---")
    print(text[:400])
    print("--- tail (streams area) ---")
    print(text[-1500:])
    print("\n--- checks ---")
    for probe in ("Woke", "Is It Woke", "Slightly woke", "Woke Score"):
        print(f"  {probe!r}: {'FOUND' if probe in text else 'missing'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
