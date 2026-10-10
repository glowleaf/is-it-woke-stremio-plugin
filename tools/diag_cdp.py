#!/usr/bin/env python
"""Step-by-step diagnosis of hooking the Stremio desktop app over CDP."""
import sys

from install_desktop_cdp import evaluate, find_page

ADDON_URL = "https://relay.loveisbitcoin.com/woke/e30/manifest.json"


def main():
    page = find_page()
    if not page:
        print("no page target")
        return 1
    ws = page["webSocketDebuggerUrl"]
    print("target:", page.get("url"))

    print("storage keys:", evaluate(ws, "(() => Object.keys(localStorage).join(', '))()"))
    print("profile:", evaluate(ws, "(() => { const s = localStorage.getItem('profile'); if (!s) return 'MISSING'; const p = JSON.parse(s); return JSON.stringify({len: s.length, keys: Object.keys(p), addons: (p.addons||[]).length}); })()"))
    print("in-page fetch:", evaluate(ws, f"""(async () => {{
      try {{
        const r = await fetch({ADDON_URL!r}, {{cache:'no-store'}});
        const j = await r.json();
        return 'OK ' + r.status + ' id=' + j.id + ' v=' + j.version;
      }} catch (e) {{ return 'FAIL ' + e.message; }}
    }})()""", await_promise=True))

    print("\n-- attempting the write --")
    print(evaluate(ws, f"""(() => {{
      const id = 'community.woke.iiwon';
      const raw = localStorage.getItem('profile');
      if (!raw) return 'no profile';
      const p = JSON.parse(raw);
      const addons = p.addons || [];
      if (addons.some(a => a.manifest && a.manifest.id === id)) {{
        addons.sort((a, b) => (b.manifest && b.manifest.id === id ? 1 : 0) - (a.manifest && a.manifest.id === id ? 1 : 0));
        p.addons = addons;
        localStorage.setItem('profile', JSON.stringify(p));
        return 'already present, moved to front';
      }}
      return 'NOT present - manifest fetch inside the page is needed';
    }})()"""))
    print("read back:", evaluate(ws, "(() => { const p = JSON.parse(localStorage.getItem('profile')); return JSON.stringify((p.addons||[]).map(a => (a.manifest||{}).name)); })()"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
