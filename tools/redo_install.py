#!/usr/bin/env python
"""Redo the addon install in the app, clicking whatever confirm button the sheet shows."""
import re
import sys
import time

from install_desktop_cdp import ADDON_URL, evaluate, http_json, port_is_open, restart_app


def app_page(seconds=90):
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

    evaluate(ws, "(() => { location.hash = '#/addons'; return 1; })()")
    time.sleep(5)
    print(evaluate(ws, """(() => {
      const l = [...document.querySelectorAll('*')].find(e => (e.children||[]).length===0 && (e.textContent||'').trim()==='Add addon');
      if (!l) return 'no button';
      (l.closest('[class*=add-button-container]') || l).click();
      return 'opened';
    })()"""))
    time.sleep(2)
    print(evaluate(ws, """(() => {
      const i = document.querySelector('input[class*=addon-url-input]');
      if (!i) return 'no input';
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      s.call(i, %s);
      i.dispatchEvent(new Event('input', {bubbles:true}));
      i.dispatchEvent(new Event('change', {bubbles:true}));
      return 'typed';
    })()""" % repr(ADDON_URL)))
    time.sleep(1)
    print("add:", evaluate(ws, """(() => {
      const l = [...document.querySelectorAll('*')].filter(e => (e.children||[]).length===0 && /^(add)$/i.test((e.textContent||'').trim()));
      if (!l.length) return 'no Add';
      (l[0].closest('[class*=action-button]') || l[0].closest('[class*=button-container]') || l[0]).click();
      return 'clicked Add';
    })()"""))
    time.sleep(5)

    print("sheet text:", evaluate(ws, "(() => (document.body.innerText||'').slice(-320))()"))
    print("buttons:", evaluate(ws, """(() => [...document.querySelectorAll('[class*=button-container]')].map(b => (b.textContent||'').trim()).filter(t => t && t.length < 25).join(' | '))()"""))
    print("confirm:", evaluate(ws, """(() => {
      const cands = [...document.querySelectorAll('[class*=button-container],[class*=action-button]')]
        .filter(b => /^(install|update|add)$/i.test((b.textContent||'').trim()));
      if (!cands.length) return 'nothing to click';
      const b = cands[cands.length - 1];
      b.click();
      return 'clicked ' + (b.textContent||'').trim();
    })()"""))
    time.sleep(8)
    print("after:", evaluate(ws, """(() => { const p = JSON.parse(localStorage.getItem('profile')||'{}'); const a = p.addons||[]; const i = a.findIndex(x=>x.manifest && x.manifest.id==='community.woke.iiwon'); return JSON.stringify({n:a.length, index:i, resources: i>=0 ? (a[i].manifest.resources||[]).map(r=>r.name) : null}); })()"""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
