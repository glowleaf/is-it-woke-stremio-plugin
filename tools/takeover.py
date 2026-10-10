#!/usr/bin/env python
"""Make the addon the app's metadata addon: reinstall it with the current manifest (which now
mirrors Cinemeta's catalogs), then remove Cinemeta so the chip row cannot lose the meta race."""
import json
import subprocess
import sys
import time

from install_desktop_cdp import ADDON_URL, evaluate, http_json, port_is_open, restart_app


def app_page(seconds=150):
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


def names(ws):
    return evaluate(ws, """(() => { const p = JSON.parse(localStorage.getItem('profile')||'{}'); return JSON.stringify((p.addons||[]).map(a => (a.manifest||{}).name)); })()""")


def uninstall(ws, name):
    return evaluate(ws, """(() => {
      const target = %s.toLowerCase();
      const label = [...document.querySelectorAll('*')].find(e => (e.children||[]).length===0 && (e.textContent||'').trim().toLowerCase() === target);
      if (!label) return 'row not found';
      let row = label;
      for (let i = 0; i < 8 && row; i++) { if (/Uninstall/.test(row.textContent||'')) break; row = row.parentElement; }
      if (!row) return 'no row wrapper';
      const btn = [...row.querySelectorAll('[class*=button-container]')].find(b => /Uninstall/i.test(b.textContent||''));
      if (!btn) return 'no Uninstall button';
      btn.click();
      return 'clicked Uninstall';
    })()""" % json.dumps(name))


def click_text(ws, pattern):
    return evaluate(ws, """((pat) => {
      const re = new RegExp(pat, 'i');
      const cands = [...document.querySelectorAll('[class*=button-container],[class*=action-button]')].filter(b => re.test((b.textContent||'').trim()));
      if (!cands.length) return 'none';
      const b = cands[cands.length-1];
      b.click();
      return 'clicked ' + (b.textContent||'').trim();
    })""" + f"({json.dumps(pattern)})")


def install_ours(ws):
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
    })()""" % json.dumps(ADDON_URL)))
    time.sleep(1)
    print("add:", click_text(ws, '^add$'))
    time.sleep(5)
    print("install:", click_text(ws, '^install$'))
    time.sleep(8)


def main():
    if not port_is_open():
        restart_app()
    page = app_page()
    if not page:
        print("no app page")
        return 1
    ws = page["webSocketDebuggerUrl"]
    evaluate(ws, "(() => { location.hash = '#/addons'; return 1; })()")
    time.sleep(5)

    print("uninstall ours:", uninstall(ws, 'Woke Score'))
    time.sleep(3)
    print("confirm:", click_text(ws, '^(uninstall|yes|confirm)$'))
    time.sleep(5)
    install_ours(ws)
    print("resources:", evaluate(ws, """(() => { const p = JSON.parse(localStorage.getItem('profile')||'{}'); const a = p.addons||[]; const o = a.find(x=>x.manifest && x.manifest.id==='community.woke.iiwon'); return o ? JSON.stringify({resources:(o.manifest.resources||[]).map(r=>r.name), catalogs:(o.manifest.catalogs||[]).length}) : 'not installed'; })()"""))

    print("\nuninstall Cinemeta:", uninstall(ws, 'Cinemeta'))
    time.sleep(3)
    print("confirm:", click_text(ws, '^(uninstall|yes|confirm)$'))
    time.sleep(5)
    print("addons now:", names(ws))

    for image in ("stremio-shell-ng.exe", "stremio-runtime.exe"):
        subprocess.run(["taskkill", "/F", "/IM", image], capture_output=True)
    time.sleep(4)
    restart_app()
    page = app_page()
    if not page:
        print("app did not return")
        return 1
    ws = page["webSocketDebuggerUrl"]
    time.sleep(8)
    print("\nafter restart:", names(ws))

    evaluate(ws, "(() => { location.href = 'https://web.stremio.com/#/detail/movie/tt1160419'; return 1; })()")
    time.sleep(30)
    page = app_page(30) or page
    text = evaluate(page["webSocketDebuggerUrl"], "(() => (document.body.innerText||''))()") or ""
    print("\n--- Dune ---")
    for probe in ("39%", "Slightly woke", "IS IT WOKE OR NOT?", "GENRES"):
        idx = text.find(probe)
        print(f"  {probe!r}: {'FOUND at ' + str(idx) if idx >= 0 else 'missing'}")
    print("head:", text[:260].replace("\n", " | "))
    return 0


if __name__ == "__main__":
    sys.exit(main())
