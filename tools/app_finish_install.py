#!/usr/bin/env python
"""Finish the addon install in the app if the confirm sheet is still open, then report state."""
import sys
import time

from install_desktop_cdp import evaluate, find_page

CLICK_BY_TEXT = """((want) => {
  const leaves = [...document.querySelectorAll('*')].filter(e => (e.children||[]).length === 0 && (e.textContent||'').trim() === want);
  if (!leaves.length) return 'no element with text ' + want;
  const el = leaves[0];
  const target = el.closest('[class*=button-container]') || el.closest('[class*=button]') || el.parentElement || el;
  target.click();
  return 'clicked ' + want;
})"""


def state(ws):
    return evaluate(ws, """(() => {
      const p = JSON.parse(localStorage.getItem('profile')||'{}');
      const a = p.addons||[];
      const i = a.findIndex(x => x.manifest && x.manifest.id === 'community.woke.iiwon');
      return JSON.stringify({n: a.length, hasOurs: i >= 0, index: i, first: a[0] && a[0].manifest && a[0].manifest.name});
    })()""")


def main():
    page = find_page()
    if not page:
        print("no page target")
        return 1
    ws = page["webSocketDebuggerUrl"]
    text = evaluate(ws, "(() => (document.body.innerText||''))()") or ""
    print("state before:", state(ws))
    if "Install" in text:
        print(evaluate(ws, CLICK_BY_TEXT + "('Install')"))
        time.sleep(6)
    else:
        print("no Install button on screen")
    print("state after:", state(ws))
    text = evaluate(ws, "(() => (document.body.innerText||''))()") or ""
    print("Woke Score listed:", "Woke Score" in text)
    print("Uninstall buttons:", text.count("Uninstall"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
