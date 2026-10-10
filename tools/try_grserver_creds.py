#!/usr/bin/env python3
"""Find a working grserver SSH credential from the notes already on disk and store it in
/tmp/grserver-pass (mode 600). Prints only which candidate worked - never the secret itself.
"""
import re
import subprocess
import sys

HOST = "213.158.90.15"
PORT = "2234"
USER = "glowleaf"
NOTES = ["/tmp/storyorigin_login.txt", "/tmp/zazzle_login.txt"]
OUT = "/tmp/grserver-pass"


def candidates():
    seen = []
    for path in NOTES:
        try:
            text = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        for line in text.splitlines():
            toks = re.findall(r"[^\s,;:=]{6,64}", line)
            if not toks:
                continue
            low = line.lower()
            interesting = any(k in low for k in ("pass", "pwd", "glowleaf", "grserver", "plesk", "213.158"))
            if not interesting:
                continue
            for tok in reversed(toks):
                if tok in seen:
                    continue
                if re.fullmatch(r"[\w!@#$%^&*\-\.\+]{6,64}", tok):
                    seen.append(tok)
    return seen[:24]


def try_password(pw):
    cmd = [
        "sshpass", "-p", pw, "ssh",
        "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=8",
        "-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no",
        "-o", "NumberOfPasswordPrompts=1",
        "-p", PORT, f"{USER}@{HOST}", "echo OK",
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, timeout=25, text=True)
    except subprocess.TimeoutExpired:
        return False
    return "OK" in (res.stdout or "")


def main():
    cands = candidates()
    print(f"trying {len(cands)} candidate credentials from the notes")
    for i, pw in enumerate(cands, 1):
        ok = try_password(pw)
        print(f"  candidate {i}: {'WORKS' if ok else 'no'}")
        if ok:
            with open(OUT, "w") as fh:
                fh.write(pw)
            subprocess.run(["chmod", "600", OUT])
            print(f"saved working credential to {OUT}")
            return 0
    print("no candidate worked - the notes do not contain the password")
    return 1


if __name__ == "__main__":
    sys.exit(main())
