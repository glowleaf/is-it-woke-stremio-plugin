#!/usr/bin/env python
"""Reinstall the addon in the desktop app (fresh manifest) and inspect how the addon list can be
reordered, then verify the Dune page."""
import sys
import time

from install_desktop_cdp import ADDON_URL, evaluate, http_json, port_is_open, restart_app


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


CLICK_LEAF = """((want) => {
  const leaves = [...document.querySelectorAll('*')].filter(e => (e.children||[]).length === 0 && new RegExp(want, 'i').test((e.textContent||'').trim()));
  if (!leaves.length) return 'none';
  const el = leaves[0];
  (el.closest('[class*=button-container]') || el.closest('[class*=action-button]') || el).click();
  return 'clicked ' + el.textContent.trim();
})"""


def main():
    if not port_is_open():
        restart_app()
    page = app_page()
    if not page:
        print("no app page")
        return 1
    ws = page["webSocketDebuggerUrl"]

    evaluate(ws, "(() => { location.hash = '#/addons'; return 1; })()")
    time.sleep(6)

    # 1. uninstall our copy so the next install refetches the manifest
    print("uninstall:", evaluate(ws, """(() => {
      const rows = [...document.querySelectorAll('[class*=addon]')];
      const labels = [...document.querySelectorAll('*')].filter(e => (e.children||[]).length===0 && /^Woke Score$/i.test((e.textContent||'').trim()));
      if (!labels.length) return 'Woke Score row not found';
      // walk up to the row that also contains an Uninstall button
      let row = labels[0];
      for (let i = 0; i < 8 && row; i++) {
        if (/Uninstall/.test(row.textContent || '')) break;
        row = row.parentElement;
      }
      if (!row) return 'no row';
      const btn = [...row.querySelectorAll('[class*=button-container]')].find(b => /Uninstall/i.test(b.textContent||''));
      if (!btn) return 'no uninstall button';
      btn.click();
      return 'clicked Uninstall';
    })()"""))
    time.sleep(3)
    print("confirm uninstall:", evaluate(ws, CLICK_LEAF + "('^(uninstall|yes|confirm)$')"))
    time.sleep(5)

    # 2. reinstall (fresh manifest)
    print("open dialog:", evaluate(ws, """(() => {
      const l = [...document.querySelectorAll('*')].find(e => (e.children||[]).length===0 && (e.textContent||'').trim()==='Add addon');
      if (!l) return 'no Add addon';
      (l.closest('[class*=add-button-container]') || l).click();
      return 'opened';
    })()"""))
    time.sleep(2)
    print("type:", evaluate(ws, """(() => {
      const i = document.querySelector('input[class*=addon-url-input]');
      if (!i) return 'no input';
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      s.call(i, %s);
      i.dispatchEvent(new Event('input', {bubbles:true}));
      i.dispatchEvent(new Event('change', {bubbles:true}));
      return 'typed';
    })()""" % repr(ADDON_URL)))
    time.sleep(1)
    print("add:", evaluate(ws, CLICK_LEAF + "('^add$')"))
    time.sleep(5)
    print("install:", evaluate(ws, CLICK_LEAF + "('^install$')"))
    time.sleep(8)
    print("storage:", evaluate(ws, """(() => { const p = JSON.parse(localStorage.getItem('profile')||'{}'); const a = p.addons||[]; const i = a.findIndex(x=>x.manifest && x.manifest.id==='community.woke.iiwon'); return JSON.stringify({n:a.length, index:i, resources: i>=0 ? (a[i].manifest.resources||[]).map(r=>r.name) : null}); })()"""))

    # 3. how can the list be reordered?
    print("\nreorder affordances:", evaluate(ws, """(() => {
      const rows = [...document.querySelectorAll('[draggable], [class*=addon-installed], [class*=addon-list] [class*=row]')];
      const sample = rows.slice(0, 3).map(r => ({ tag: r.tagName, cls: (r.className||'').toString().slice(0,70), draggable: r.getAttribute('draggable'), html: (r.innerHTML||'').slice(0,140) }));
      const handles = [...document.querySelectorAll('[class*=drag], [class*=handle], [class*=grip]')].map(h => (h.className||'').toString().slice(0,50));
      return JSON.stringify({ rows: sample.length, sample, handles: handles.slice(0, 6) }, null, 1);
    })()"""))

    # 4. verify on Dune
    evaluate(ws, "(() => { location.href = 'https://web.stremio.com/#/detail/movie/tt1160419'; return 1; })()")
    time.sleep(32)
    page = app_page(30) or page
    text = evaluate(page["webSocketDebuggerUrl"], "(() => (document.body.innerText||''))()") or ""
    print("\n--- Dune page ---")
    for probe in ("39%", "Woke", "Slightly woke", "8.0"):
        idx = text.find(probe)
        print(f"  {probe!r}: {'FOUND at ' + str(idx) if idx >= 0 else 'missing'}")
        if idx > 0:
            print("      ", text[max(0, idx - 90):idx + 140].replace("\n", " | "))
    return 0


if __name__ == "__main__":
    sys.exit(main())
