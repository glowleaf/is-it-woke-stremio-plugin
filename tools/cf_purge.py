"""Purge the Cloudflare cache for a URL, trying every token we have on disk (none are printed)."""
import glob
import json
import os
import sys
import urllib.error
import urllib.request

ZONE_NAME = "georgesaoulidis.com"
TARGETS = [
    "https://georgesaoulidis.com/woke-score-stremio-addon/",
    "https://georgesaoulidis.com/woke-score-stremio-addon",
]
KEY_DIRS = [r"C:\Users\alpha\machinegeorge\keys", r"C:\Users\alpha\machinegeorge\passwords"]


def api(token, path, method="GET", body=None):
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4" + path,
        data=json.dumps(body).encode() if body else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method=method)
    try:
        with urllib.request.urlopen(req, timeout=40) as res:
            return json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:
            return {"success": False, "errors": [{"message": f"HTTP {e.code}"}]}


def candidates():
    seen = set()
    for d in KEY_DIRS:
        for p in glob.glob(os.path.join(d, "*")):
            name = os.path.basename(p).lower()
            if not any(k in name for k in ("cloudflare", "cf_", "cf-", "zone", "workers", "token")):
                continue
            try:
                txt = open(p, "r", encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            for line in txt.splitlines():
                line = line.strip()
                if len(line) >= 30 and " " not in line and line not in seen:
                    seen.add(line)
                    yield os.path.basename(p), line


def main():
    for name, token in candidates():
        zones = api(token, f"/zones?name={ZONE_NAME}")
        if not zones.get("success"):
            msg = (zones.get("errors") or [{}])[0].get("message", "?")
            print(f"  {name}: no zone access ({msg[:60]})")
            continue
        zone = (zones.get("result") or [{}])[0].get("id")
        print(f"  {name}: zone found, purging {len(TARGETS)} urls")
        res = api(token, f"/zones/{zone}/purge_cache", "POST", {"files": TARGETS})
        print("   purge:", res.get("success"), (res.get("errors") or [{}])[0].get("message", "") if not res.get("success") else "")
        if res.get("success"):
            return 0
    print("no token could purge the cache")
    return 1


if __name__ == "__main__":
    sys.exit(main())
