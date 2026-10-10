#!/usr/bin/env python
"""Install the Woke Score addon through the Stremio desktop app's OWN UI (over CDP).

Going through the app's code path is what makes the app persist the addon in its own store,
instead of a localStorage write that the shell can overwrite on the next boot.
"""
import json
import sys
import time

from install_desktop_cdp import evaluate, find_page

ADDON_URL = "https://relay.loveisbitcoin.com/woke/e30/manifest.json"

CLICK_BY_TEXT = """((want) => {
  const leaves = [...document.querySelectorAll('*')].filter(e => (e.children||[]).length === 0 && (e.textContent||'').trim() === want);
  if (!leaves.length) return 'no element with text ' + want;
  const el = leaves[0];
  const target = el.closest('[class*=button]') || el.parentElement || el;
  target.click();
  return 'clicked ' + want + ' on ' + target.tagName + '.' + (target.className||'').toString().slice(0,50);
})"""


def main():
    page = find_page()
    if not page:
        print("no page target")
        return 1
    ws = page["webSocketDebuggerUrl"]

    evaluate(ws, "(() => { location.hash = '#/addons'; return 1; })()")
    time.sleep(6)
    print("page:", evaluate(ws, "(() => (document.body.innerText||'').slice(0,300))()"))

    print(evaluate(ws, "(() => { const l = document.querySelector('.add-button-label-NN6bu') || [...document.querySelectorAll('*')].find(e => (e.textContent||'').trim() === 'Add addon'); if (!l) return 'no Add addon'; const t = l.closest('[class*=add-button-container]') || l; t.click(); return 'opened dialog'; })()"))
    time.sleep(2)

    print("dialog:", evaluate(ws, "(() => { const i = document.querySelector('input[class*=addon-url-input]'); return i ? 'input present ph=' + i.placeholder : 'no input'; })()"))
    print(evaluate(ws, f"""(() => {{
      const i = document.querySelector('input[class*=addon-url-input]');
      if (!i) return 'no input';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, {ADDON_URL!r});
      i.dispatchEvent(new Event('input', {{bubbles:true}}));
      i.dispatchEvent(new Event('change', {{bubbles:true}}));
      return 'typed ' + i.value;
    }})()"""))
    time.sleep(1)
    print(evaluate(ws, CLICK_BY_TEXT + "('Add')"))
    time.sleep(3)
    print("after Add:", evaluate(ws, "(() => (document.body.innerText||'').slice(-350))()"))
    print(evaluate(ws, CLICK_BY_TEXT + "('Install')"))
    time.sleep(5)

    text = evaluate(ws, "(() => (document.body.innerText||''))()") or ""
    print("\nWoke Score listed:", "Woke Score" in text)
    print("storage:", evaluate(ws, """(() => { const p = JSON.parse(localStorage.getItem('profile')||'{}'); const a = p.addons||[]; return JSON.stringify({n: a.length, first: a[0] && a[0].manifest && a[0].manifest.name, hasOurs: a.some(x => x.manifest && x.manifest.id === 'community.woke.iiwon'), idx: a.findIndex(x => x.manifest && x.manifest.id === 'community.woke.iiwon')}); })()"""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
