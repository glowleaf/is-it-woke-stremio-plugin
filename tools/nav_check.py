#!/usr/bin/env python
"""Navigate the app's page with Page.navigate (hash-only changes are ignored by the router)
and read back the streams area."""
import json
import sys
import time

import websocket

from install_desktop_cdp import find_page, wait_for_page

TT = sys.argv[1] if len(sys.argv) > 1 else "tt1160419"
TYPE = sys.argv[2] if len(sys.argv) > 2 else "movie"


def command(ws_url, method, params=None, timeout=60):
    ws = websocket.create_connection(ws_url, timeout=timeout, suppress_origin=True)
    try:
        ws.send(json.dumps({"id": 1, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = json.loads(ws.recv())
            if msg.get("id") == 1:
                return msg
        return {"error": "timeout"}
    finally:
        ws.close()


def text_of(ws_url):
    res = command(ws_url, "Runtime.evaluate", {"expression": "(() => (document.body.innerText||''))()", "returnByValue": True})
    return (res.get("result", {}).get("result", {}) or {}).get("value") or ""


def main():
    page = wait_for_page(60)
    if not page:
        print("no debug target")
        return 1
    ws = page["webSocketDebuggerUrl"]
    url = f"https://web.stremio.com/#/detail/{TYPE}/{TT}"
    print("navigating to", url)
    print("nav:", command(ws, "Page.navigate", {"url": url}))
    time.sleep(12)
    page = find_page() or page
    ws = page["webSocketDebuggerUrl"]
    print("url now:", command(ws, "Runtime.evaluate", {"expression": "(() => location.href.slice(0,90))()", "returnByValue": True}).get("result", {}).get("result", {}).get("value"))
    time.sleep(22)
    t = text_of(ws)
    print("len:", len(t))
    print("--- head ---\n", t[:700])
    print("--- tail ---\n", t[-1300:])
    print("\n--- checks ---")
    for probe in ("Woke", "Is It Woke", "Slightly woke", "GENRES", "Sources", "Torrentio"):
        print(f"  {probe!r}: {'FOUND' if probe in t else 'missing'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
