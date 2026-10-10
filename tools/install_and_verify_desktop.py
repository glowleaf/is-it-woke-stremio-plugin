#!/usr/bin/env python
"""One-shot: open the debug port, install the addon through the app's own UI, verify the
stream-list entry renders. Leaves the app running and installed.
"""
import sys
import time

from install_desktop_cdp import ADDON_URL, evaluate, find_page, port_is_open, restart_app, wait_for_page

CLICK = """((want) => {
  const leaves = [...document.querySelectorAll('*')].filter(e => (e.children||[]).length === 0 && (e.textContent||'').trim() === want);
  if (!leaves.length) return 'no ' + want;
  const el = leaves[0];
  const target = el.closest('[class*=button-container]') || el.closest('[class*=button]') || el.parentElement || el;
  target.click();
  return 'clicked ' + want;
})"""

OPEN_DIALOG = """(() => {
  const l = [...document.querySelectorAll('*')].find(e => (e.children||[]).length === 0 && (e.textContent||'').trim() === 'Add addon');
  if (!l) return 'no Add addon';
  (l.closest('[class*=add-button-container]') || l).click();
  return 'dialog opened';
})()"""

TYPE_URL = """(() => {
  const i = document.querySelector('input[class*=addon-url-input]');
  if (!i) return 'no input';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, %s);
  i.dispatchEvent(new Event('input', {bubbles:true}));
  i.dispatchEvent(new Event('change', {bubbles:true}));
  return 'typed';
})()"""

STORAGE = """(() => {
  const p = JSON.parse(localStorage.getItem('profile') || '{}');
  const a = p.addons || [];
  const i = a.findIndex(x => x.manifest && x.manifest.id === 'community.woke.iiwon');
  return JSON.stringify({ addons: a.length, installed: i >= 0, index: i, order: a.map(x => x.manifest && x.manifest.name).slice(0, 4) });
})()"""


def main():
    if not port_is_open():
        restart_app()
    page = wait_for_page(90)
    if not page:
        print("FAILED: no debug target")
        return 1
    ws = page["webSocketDebuggerUrl"]
    print("target:", page.get("url"))

    evaluate(ws, "(() => { location.hash = '#/addons'; return 1; })()")
    time.sleep(6)
    print(OPEN_DIALOG, "->", evaluate(ws, OPEN_DIALOG))
    time.sleep(2)
    print("type ->", evaluate(ws, TYPE_URL % repr(ADDON_URL)))
    time.sleep(1)
    print("add ->", evaluate(ws, CLICK + "('Add')"))
    time.sleep(4)
    print("install ->", evaluate(ws, CLICK + "('Install')"))
    time.sleep(7)
    print("storage after install:", evaluate(ws, STORAGE))

    evaluate(ws, "(() => { location.hash = '#/detail/movie/tt1160419'; return 1; })()")
    time.sleep(22)
    text = evaluate(ws, "(() => (document.body.innerText || ''))()") or ""
    print("\n--- stream list check ---")
    for probe in ("Woke 39%", "Slightly woke", "Is It Woke", "IS IT WOKE OR NOT?"):
        idx = text.find(probe)
        print(f"  {probe!r}: {'FOUND at ' + str(idx) if idx >= 0 else 'missing'}")
        if idx > 0:
            print("      ", text[max(0, idx - 80):idx + 160].replace("\n", " | "))
    return 0


if __name__ == "__main__":
    sys.exit(main())
