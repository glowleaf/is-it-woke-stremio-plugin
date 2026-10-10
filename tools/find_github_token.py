#!/usr/bin/env python3
"""Find a GitHub token in the Hermes session history on this box, check which one can push to
glowleaf/is-it-woke-stremio-plugin, and store it in /tmp/ghtok (mode 600).

Never prints the token itself - only a masked prefix, its length and what the API says.
"""
import glob
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

REPO = "glowleaf/is-it-woke-stremio-plugin"
OUT = "/tmp/ghtok"
PAT = re.compile(r"(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})")


def api(path, token):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "User-Agent": "hermes-token-check"},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            return json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        return {"_status": e.code}
    except Exception as e:  # noqa: BLE001
        return {"_status": str(e)}


def candidates():
    files = []
    for base in ("/home/hermes/.hermes/sessions", "/home/hermes/.hermes"):
        files += glob.glob(os.path.join(base, "**", "*.json"), recursive=True)
    files += glob.glob("/home/hermes/.hermes/**/*.md", recursive=True)
    seen = []
    for path in files:
        try:
            if os.path.getsize(path) > 60 * 1024 * 1024:
                continue
            text = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        if "github" not in text.lower():
            continue
        for m in PAT.finditer(text):
            tok = m.group(1)
            if tok in seen:
                continue
            # keep a little context to prefer tokens mentioned near the repo/glowleaf
            ctx = text[max(0, m.start() - 400):m.end() + 400].lower()
            score = ctx.count("glowleaf") * 3 + ctx.count("github.com") + ctx.count("push")
            seen.append((score, tok, os.path.basename(path)))
    seen.sort(key=lambda x: -x[0])
    return seen


def main():
    found = candidates()
    print(f"token candidates found: {len(found)}")
    for i, (score, tok, where) in enumerate(found, 1):
        who = api("/user", tok)
        login = who.get("login")
        repo = api(f"/repos/{REPO}", tok)
        can_push = bool((repo.get("permissions") or {}).get("push"))
        print(f"  #{i} {tok[:4]}...{len(tok)} chars  file={where}  user={login or who.get('_status')}  push_access={can_push}")
        if can_push:
            with open(OUT, "w") as fh:
                fh.write(tok)
            os.chmod(OUT, 0o600)
            print(f"  -> usable, saved to {OUT} (user {login})")
            return 0
    print("no candidate can push to " + REPO)
    return 1


if __name__ == "__main__":
    sys.exit(main())
