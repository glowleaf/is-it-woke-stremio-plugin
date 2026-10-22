"""Put Woke Score first in the Stremio account collection, via api.strem.io.

The desktop app keeps its account auth key in the WebView2 local storage; this reads it there and
uses it in-process. Never prints the key - only the resulting addon order.

Why: Stremio renders the first meta addon in the collection order, and phone/TV builds cannot
reorder addons at all (they tell you to use a desktop). Setting it once here fixes every device on
the account.
"""
import glob
import json
import os
import re
import urllib.request

BASE = os.path.expandvars(r'%LOCALAPPDATA%\Programs\Stremio\stremio-shell-ng.exe.WebView2\EBWebView\Default\Local Storage\leveldb')
ADDON_ID = "community.woke.iiwon"
ADDON_URL = "https://scrut.greekai.gr/woke/eyJ2IjoyfQ/manifest.json"


def api(method, body):
    req = urllib.request.Request(f"https://api.strem.io/api/{method}", data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as res:
        return json.loads(res.read().decode())


def get_json(url):
    req = urllib.request.Request(url, headers={"user-agent": "woke-order-fix"})
    with urllib.request.urlopen(req, timeout=40) as res:
        return json.loads(res.read().decode())


def find_key():
    blob = b""
    for f in glob.glob(os.path.join(BASE, "*")):
        try:
            blob += open(f, "rb").read()
        except OSError:
            pass
    cands = []
    for enc in ("utf-16-le", "utf-8"):
        text = blob.decode(enc, "ignore")
        # stremio profile keys are ULID-ish (start with 01, 24-40 chars of base32-ish alnum)
        cands += re.findall(r"(01[A-Za-z0-9]{18,40})", text)
        # and generically: whatever follows the word "key" in the auth block
        for m in re.finditer(r'key["\s:]{1,6}', text):
            tail = re.sub(r"[^A-Za-z0-9]", "", text[m.end():m.end() + 80])
            if len(tail) >= 20:
                cands.append(tail[:32])
    seen = []
    for c in cands:
        if c not in seen:
            seen.append(c)
    seen.sort(key=lambda c: 0 if c.startswith("01") else 1)
    return seen


def names(addons):
    return [(a.get("manifest") or {}).get("name", "?") for a in addons]


def main():
    for key in find_key()[:12]:
        try:
            got = api("addonCollectionGet", {"type": "AddonCollectionGet", "authKey": key, "update": True})
        except Exception:
            continue
        result = got.get("result") or {}
        addons = result.get("addons")
        if not addons:
            continue
        print("account collection found:", len(addons), "addons")
        print("before:", " | ".join(names(addons)))
        i = next((n for n, a in enumerate(addons) if (a.get("manifest") or {}).get("id") == ADDON_ID), -1)
        print("Woke Score index before:", i)
        if i == 0:
            print("already first - nothing to do")
            return 0
        if i < 0:
            print("not installed on this account")
            return 1
        ours = addons.pop(i)
        try:
            ours["manifest"] = get_json(ADDON_URL)
        except Exception as e:
            print("manifest refresh failed, keeping stored one:", e)
        ours["transportUrl"] = ADDON_URL
        addons.insert(0, ours)
        api("addonCollectionSet", {"type": "AddonCollectionSet", "authKey": key, "addons": addons})
        after = api("addonCollectionGet", {"type": "AddonCollectionGet", "authKey": key, "update": True})
        final = (after.get("result") or {}).get("addons") or []
        print("after:", " | ".join(names(final)))
        print("Woke Score index after:", next((n for n, a in enumerate(final) if (a.get("manifest") or {}).get("id") == ADDON_ID), -1))
        return 0
    print("no usable Stremio key found in the app storage")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
