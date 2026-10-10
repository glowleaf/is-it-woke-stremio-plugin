#!/usr/bin/env python
"""Restart the app (Stremio re-reads addon manifests on start) and check whether the stream row
now shows plus whether the stored manifest picked up the stream resource."""
import sys
import time

from install_desktop_cdp import evaluate, http_json, port_is_open, restart_app

STORAGE = """(() => { const p = JSON.parse(localStorage.getItem('profile')||'{}'); const a = p.addons||[]; const i = a.findIndex(x=>x.manifest && x.manifest.id==='community.woke.iiwon'); return JSON.stringify({n:a.length, index:i, resources: i>=0 ? (a[i].manifest.resources||[]).map(r=>r.name) : null}); })()"""


def app_page(seconds=120):
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


def main():
    if not port_is_open():
        restart_app()
    page = app_page()
    if not page:
        print("no app page")
        return 1
    ws = page["webSocketDebuggerUrl"]
    time.sleep(5)
    print("resources now:", evaluate(ws, STORAGE))
    evaluate(ws, "(() => { location.href = 'https://web.stremio.com/#/detail/movie/tt1160419'; return 1; })()")
    time.sleep(32)
    page = app_page(30) or page
    text = evaluate(page["webSocketDebuggerUrl"], "(() => (document.body.innerText||''))()") or ""
    print("page len:", len(text))
    for probe in ("Woke 39%", "Slightly woke", "IS IT WOKE OR NOT?", "GENRES"):
        print(f"  {probe!r}: {'FOUND' if probe in text else 'missing'}")
    i = text.find("Woke")
    if i >= 0:
        print("context:", text[max(0, i - 250):i + 300].replace("\n", " | "))
    return 0


if __name__ == "__main__":
    sys.exit(main())
