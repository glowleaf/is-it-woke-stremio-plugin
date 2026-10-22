"""Read the SOURCES LIST (not the meta area) from the live desktop client, to confirm the score
entry renders in the order-free channel."""
import json
import re
import sys
import time

from install_desktop_cdp import evaluate, http_json, port_is_open, restart_app

TT = sys.argv[1] if len(sys.argv) > 1 else "tt1160419"
TYPE = sys.argv[2] if len(sys.argv) > 2 else "movie"


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
    evaluate(ws, f"(() => {{ location.href = 'https://web.stremio.com/#/detail/{TYPE}/{TT}'; return 1; }})()")
    time.sleep(32)

    # the sources list container: the nearest scrollable ancestor common to the stream rows
    out = evaluate(ws, """(() => {
      const rows = [...document.querySelectorAll('*')].filter(e => (e.children||[]).length === 0 && /Torrentio/i.test(e.textContent||''));
      if (!rows.length) return JSON.stringify({found: false});
      let container = rows[0];
      for (let i = 0; i < 12 && container; i++) {
        if (/Torrentio/.test(container.textContent || '') && container.textContent.length > 400) break;
        container = container.parentElement;
      }
      const text = (container || rows[0]).innerText || '';
      return JSON.stringify({
        found: true,
        rows: rows.length,
        hasWoke: /Woke/.test(text),
        wokeLines: (text.match(/[^\\n]*Woke[^\\n]*/g) || []).slice(0, 4),
        first300: text.slice(0, 300),
      });
    })()""")
    print(json.dumps(json.loads(out or "{}"), indent=1)[:1200])
    return 0


if __name__ == "__main__":
    sys.exit(main())
