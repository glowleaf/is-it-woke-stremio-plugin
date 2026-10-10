#!/usr/bin/env python
"""Final install pass: wait for the app's real page, install/reinstall through the app's own UI
(so it re-fetches the manifest, which now includes the stream resource), then verify.
"""
import sys
import time

from install_desktop_cdp import ADDON_URL, evaluate, find_page, http_json, port_is_open, restart_app

CLICK = """((want) => {
  const leaves = [...document.querySelectorAll('*')].filter(e => (e.children||[]).length === 0 && (e.textContent||'').trim() === want);
  if (!leaves.length) return 'no ' + want;
  const el = leaves[0];
  const target = el.closest('[class*=button-container]') || el.closest('[class*=button]') || el.parentElement || el;
  target.click();
  return 'clicked ' + want;
})"""


def app_page(seconds=120):
    """Wait for the app's web.stremio.com page (about:blank is useless: localStorage denied)."""
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
        print("FAILED: app page never appeared")
        return 1
    ws = page["webSocketDebuggerUrl"]
    print("target:", page["url"])

    before = evaluate(ws, """(() => { const p = JSON.parse(localStorage.getItem('profile')||'{}'); const a = p.addons||[]; const i = a.findIndex(x=>x.manifest && x.manifest.id==='community.woke.iiwon'); return JSON.stringify({n:a.length, index:i, resources: i>=0 ? (a[i].manifest.resources||[]).map(r=>r.name) : null}); })()""")
    print("before:", before)

    print(evaluate(ws, "(() => { location.hash = '#/addons'; return 1; })()"))
    time.sleep(6)
    print("dialog:", evaluate(ws, """(() => {
      const l = [...document.querySelectorAll('*')].find(e => (e.children||[]).length===0 && (e.textContent||'').trim()==='Add addon');
      if (!l) return 'no Add addon button';
      (l.closest('[class*=add-button-container]') || l).click();
      return 'opened';
    })()"""))
    time.sleep(2)
    print("type:", evaluate(ws, """(() => {
      const i = document.querySelector('input[class*=addon-url-input]');
      if (!i) return 'no input';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      setter.call(i, %s);
      i.dispatchEvent(new Event('input', {bubbles:true}));
      i.dispatchEvent(new Event('change', {bubbles:true}));
      return 'typed';
    })()""" % repr(ADDON_URL)))
    time.sleep(1)
    print("add:", evaluate(ws, CLICK + "('Add')"))
    time.sleep(5)
    print("install:", evaluate(ws, CLICK + "('Install')"))
    time.sleep(8)

    print("after:", evaluate(ws, """(() => { const p = JSON.parse(localStorage.getItem('profile')||'{}'); const a = p.addons||[]; const i = a.findIndex(x=>x.manifest && x.manifest.id==='community.woke.iiwon'); return JSON.stringify({n:a.length, index:i, resources: i>=0 ? (a[i].manifest.resources||[]).map(r=>r.name) : null}); })()"""))

    evaluate(ws, "(() => { location.href = 'https://web.stremio.com/#/detail/movie/tt1160419'; return 1; })()")
    time.sleep(30)
    page = app_page(30) or page
    text = evaluate(page["webSocketDebuggerUrl"], "(() => (document.body.innerText||''))()") or ""
    print("\npage len:", len(text))
    for probe in ("Woke 39%", "Slightly woke", "IS IT WOKE OR NOT?", "GENRES"):
        idx = text.find(probe)
        print(f"  {probe!r}: {'FOUND at ' + str(idx) if idx >= 0 else 'missing'}")
    i = text.find("Woke")
    if i >= 0:
        print("\ncontext:\n", text[max(0, i - 250):i + 350])
    return 0


if __name__ == "__main__":
    sys.exit(main())
