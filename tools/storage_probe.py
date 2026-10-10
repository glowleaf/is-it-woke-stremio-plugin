#!/usr/bin/env python
"""Read the desktop app's storage state + notifications after reloading."""
import sys
import time

from install_desktop_cdp import evaluate, find_page


def main():
    page = find_page()
    if not page:
        print("no page target")
        return 1
    ws = page["webSocketDebuggerUrl"]
    print("profile now:", evaluate(ws, """(() => {
      const p = JSON.parse(localStorage.getItem('profile') || '{}');
      const a = p.addons || [];
      return JSON.stringify({n: a.length, first3: a.slice(0,3).map(x => x.manifest && x.manifest.name), hasOurs: a.some(x => x.manifest && x.manifest.id === 'community.woke.iiwon')});
    })()"""))
    print("notifications:", evaluate(ws, "(() => (localStorage.getItem('notifications') || '').slice(0, 300))()"))
    print("all keys:", evaluate(ws, "(() => Object.keys(localStorage).join(', '))()"))
    print("url:", evaluate(ws, "(() => location.href)()"))
    print("board text (first 600):", evaluate(ws, "(() => (document.body.innerText||'').slice(0,600))()"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
