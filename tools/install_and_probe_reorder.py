#!/usr/bin/env python
"""Reinstall the addon (it is currently missing from the collection), then look for a real
reorder affordance in the app's Addons list and use it."""
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
    print("addons:", names(ws))

    # --- install our addon through the UI ---
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
    print("click Add:", evaluate(ws, """(() => {
      const cands = [...document.querySelectorAll('[class*=action-button],[class*=button-container]')].filter(b => /^add$/i.test((b.textContent||'').trim()));
      if (!cands.length) return 'no Add';
      cands[cands.length-1].click();
      return 'clicked Add';
    })()"""))
    time.sleep(5)
    print("sheet tail:", evaluate(ws, "(() => (document.body.innerText||'').slice(-200).replace(/\\n/g,' | '))()"))
    print("click Install:", evaluate(ws, """(() => {
      const cands = [...document.querySelectorAll('[class*=action-button],[class*=button-container]')].filter(b => /^install$/i.test((b.textContent||'').trim()));
      if (!cands.length) return 'no Install';
      cands[cands.length-1].click();
      return 'clicked Install (' + cands.length + ' candidates)';
    })()"""))
    time.sleep(8)
    print("after install:", names(ws))

    # --- reorder affordances ---
    print("\nreorder DOM:", evaluate(ws, """(() => {
      const sel = '[data-rbd-draggable-id],[data-rbd-drag-handle-context-id],[data-rfd-draggable-id],[aria-roledescription]';
      const els = [...document.querySelectorAll(sel)].slice(0, 6).map(e => ({ tag: e.tagName, attr: e.getAttributeNames().filter(a => a.startsWith('data-') || a === 'aria-roledescription').join(','), roledesc: e.getAttribute('aria-roledescription') }));
      const dnd = [...document.querySelectorAll('[class*=drag],[class*=Drag],[class*=handle],[class*=Handle],[class*=sortable],[class*=Sortable],[class*=reorder],[class*=Reorder]')].slice(0,6).map(e => (e.className||'').toString().slice(0,60));
      return JSON.stringify({ els, dnd, hasRbd: !!document.querySelector('[data-rbd-draggable-id]'), hasRfd: !!document.querySelector('[data-rfd-draggable-id]') }, null, 1);
    })()"""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
