#!/usr/bin/env python
"""Install the Woke Score addon into the Stremio DESKTOP app (Windows, WebView2 shell).

The desktop app keeps its addon collection in the web app's own localStorage (no account is
involved), so this:
  1. restarts the app with a WebView2 remote-debugging port,
  2. connects to the app's own page over CDP,
  3. reads its profile, puts the addon at the FRONT of the addon list (Stremio shows the first
     meta addon that loads, so this is what makes the chips win over Cinemeta),
  4. reloads and opens a movie page, then reads the rendered text back as proof.

A backup of the original profile JSON is written to data/desktop-profile-backup.json.
Run:  python tools/install_desktop_cdp.py [addon-url]
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

import websocket

ADDON_ID = "community.woke.iiwon"
ADDON_URL = sys.argv[1] if len(sys.argv) > 1 else "https://relay.loveisbitcoin.com/woke/e30/manifest.json"
PORT = 9223
APP = os.path.expandvars(r"%LOCALAPPDATA%\Programs\Stremio\stremio-shell-ng.exe")
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
PROBE_TITLE = "#/detail/movie/tt1160419"  # Dune (2021)


def http_json(path, timeout=10):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=timeout) as res:
        return json.loads(res.read().decode())


def evaluate(ws_url, expression, await_promise=False, timeout=90):
    # suppress_origin: Chrome rejects handshakes from an http origin unless it was started
    # with --remote-allow-origins, and we do not want to require another app restart.
    ws = websocket.create_connection(ws_url, timeout=timeout, suppress_origin=True)
    try:
        ws.send(json.dumps({
            "id": 1,
            "method": "Runtime.evaluate",
            "params": {"expression": expression, "awaitPromise": await_promise, "returnByValue": True},
        }))
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = json.loads(ws.recv())
            if msg.get("id") == 1:
                result = msg.get("result", {})
                if result.get("exceptionDetails"):
                    raise RuntimeError(json.dumps(result["exceptionDetails"])[:400])
                return result.get("result", {}).get("value")
        raise TimeoutError("no CDP reply")
    finally:
        ws.close()


def find_page():
    targets = http_json("/json/list")
    for target in targets:
        if target.get("type") == "page" and "stremio" in (target.get("url") or "").lower():
            return target
    for target in targets:
        if target.get("type") == "page" and target.get("webSocketDebuggerUrl") and (target.get("url") or "") not in ("about:blank", ""):
            return target
    for target in targets:
        if target.get("type") == "page" and target.get("webSocketDebuggerUrl"):
            return target
    return None


def port_is_open():
    try:
        http_json("/json/version", timeout=3)
        return True
    except Exception:
        return False


def restart_app():
    for image in ("stremio-shell-ng.exe", "stremio-runtime.exe"):
        subprocess.run(["taskkill", "/F", "/IM", image], capture_output=True)
    time.sleep(3)
    env = os.environ.copy()
    env["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = f"--remote-debugging-port={PORT}"
    subprocess.Popen([APP], env=env, close_fds=True)
    print("restarted Stremio with the debug port")


def wait_for_page(seconds=60):
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            page = find_page()
            if page:
                return page
        except Exception:
            pass
        time.sleep(2)
    return None


INSTALL_JS = """(async () => {
  const url = %s;
  const id = %s;
  const stored = localStorage.getItem('profile');
  if (!stored) return JSON.stringify({ error: 'no profile in app storage' });
  const p = JSON.parse(stored);
  const addons = p.addons || [];
  const had = addons.findIndex(a => a.manifest && a.manifest.id === id);
  let entry;
  if (had >= 0) {
    entry = addons.splice(had, 1)[0];
  } else {
    const manifest = await (await fetch(url, {cache: 'no-store'})).json();
    entry = { manifest, transportUrl: url, transportName: 'Woke Score', flags: { official: false, protected: false } };
  }
  addons.unshift(entry);
  p.addons = addons;
  window.__wokeBackup = stored;
  localStorage.setItem('profile', JSON.stringify(p));
  return JSON.stringify({ before: had >= 0 ? 'already installed at index ' + had : 'new install',
                          order: addons.map(a => (a.manifest || {}).name) });
})()"""


def main():
    if port_is_open():
        print("debug port already open - reusing the running app")
    else:
        restart_app()
    page = wait_for_page()
    if not page:
        print("The app's debug port never came up - the WebView2 loader ignored the flag.")
        print("Fallback: open the app, Addons -> Add addon -> paste " + ADDON_URL + " -> Install,")
        print("then drag 'Woke Score' to the top of the list.")
        return 1
    ws_url = page["webSocketDebuggerUrl"]
    print("attached to:", page.get("url"))

    time.sleep(3)
    result = evaluate(ws_url, INSTALL_JS % (json.dumps(ADDON_URL), json.dumps(ADDON_ID)), await_promise=True)
    print("install:", result)

    backup = evaluate(ws_url, "(() => window.__wokeBackup || null)()")
    if backup:
        os.makedirs(DATA_DIR, exist_ok=True)
        path = os.path.join(DATA_DIR, "desktop-profile-backup.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(backup)
        print("backup written:", path)

    # Reload so the app reads the new collection, then open a movie page and read the UI back.
    evaluate(ws_url, f"(() => {{ location.hash = '{PROBE_TITLE}'; location.reload(); return 'reloading'; }})()")
    time.sleep(18)
    page = find_page() or page
    text = evaluate(page["webSocketDebuggerUrl"], "(() => (document.body.innerText || '').slice(0, 1200))()")
    print("\n--- what the app renders now ---")
    print(text)
    ok = "Slightly woke" in (text or "") and "Woke factors" in (text or "")
    print("\nRESULT:", "chips render in the app" if ok else "chips NOT visible - check the addon order")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
