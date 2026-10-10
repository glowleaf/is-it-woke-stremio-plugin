#!/usr/bin/env python
"""Install (or re-install) the Woke Score addon into THIS machine's Stremio account.

The Stremio desktop app keeps its session in the WebView2 profile, so the account auth key is
read from there and used in-process. The key is never printed and never written anywhere -
only the resulting addon order is reported.

Run:  python tools/install_to_stremio.py [manifest-url]
"""
import glob
import json
import os
import re
import sys
import urllib.request

ADDON_URL = sys.argv[1] if len(sys.argv) > 1 else "https://relay.loveisbitcoin.com/woke/e30/manifest.json"
API = "https://api.strem.io/api/"
LEVELDB = os.path.expandvars(
    r"%LOCALAPPDATA%\Programs\Stremio\stremio-shell-ng.exe.WebView2\EBWebView\Default\Local Storage\leveldb"
)


def api(method, body):
    req = urllib.request.Request(
        API + method, data=json.dumps(body).encode(), headers={"content-type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=40) as res:
        return json.loads(res.read().decode())


def get_json(url):
    req = urllib.request.Request(url, headers={"user-agent": "woke-score-install"})
    with urllib.request.urlopen(req, timeout=40) as res:
        return json.loads(res.read().decode())


def find_auth_key():
    """Pull candidate keys straight out of the app's local storage; test them against the API."""
    if not os.path.isdir(LEVELDB):
        sys.exit(f"Stremio's local storage was not found at {LEVELDB}")
    blob = b""
    for path in glob.glob(os.path.join(LEVELDB, "*")):
        try:
            with open(path, "rb") as fh:
                blob += fh.read()
        except OSError:
            pass

    # LevelDB record: key "_https://web.stremio.com\x00\x01authKey" -> value holds the key.
    candidates = list(dict.fromkeys(m.decode() for m in re.findall(rb"authKey[^0-9a-f]{0,8}([0-9a-f]{32})", blob)))
    if not candidates:
        candidates = list(dict.fromkeys(m.decode() for m in re.findall(rb"[0-9a-f]{32}", blob)))[:40]

    for key in candidates:
        try:
            res = api("addonCollectionGet", {"type": "AddonCollectionGet", "authKey": key, "update": True})
        except Exception:
            continue
        if res.get("result") and res["result"].get("addons") is not None:
            return key, res["result"]["addons"]
    sys.exit(
        "No working Stremio session found in the desktop app's storage.\n"
        "Log in inside the Stremio app first (or install the URL manually: " + ADDON_URL + ")"
    )


def names(addons):
    return [((a.get("manifest") or {}).get("name") or "?") + (" [protected]" if (a.get("flags") or {}).get("protected") else "") for a in addons]


def main():
    key, addons = find_auth_key()
    print(f"session found ({len(addons)} addons installed)")
    print("before: " + " | ".join(names(addons)))

    manifest = get_json(ADDON_URL)
    ours = {
        "transportUrl": ADDON_URL,
        "transportName": "",
        "manifest": manifest,
        "flags": {"official": False, "protected": False},
    }
    others = [a for a in addons if ((a.get("manifest") or {}).get("id")) != manifest["id"]]
    new = [ours] + others  # first in the list = first meta addon Stremio asks = chips win over Cinemeta

    api("addonCollectionSet", {"type": "AddonCollectionSet", "authKey": key, "addons": new})
    verify = api("addonCollectionGet", {"type": "AddonCollectionGet", "authKey": key, "update": True})
    after = verify["result"]["addons"]
    print("after:  " + " | ".join(names(after)))

    first = (after[0].get("manifest") or {}).get("id")
    if first != manifest["id"]:
        sys.exit(f"FAILED: {manifest['id']} is not first ({first} is)")
    print(f"\nOK: {manifest['name']} v{manifest['version']} installed as the first addon.")


if __name__ == "__main__":
    main()
