import json
import os
import re
import shutil
import subprocess
import sys

VAULT = r"C:\Users\alpha\machinegeorge\tools\vault_lookup.py"
PROJECT = r"C:\Users\alpha\machinegeorge\stremio-woke"


def mcp_url():
    out = subprocess.run([sys.executable, VAULT, "GEORGESAOULIDIS_MCP_URL"],
                         capture_output=True, text=True, timeout=60)
    url = (out.stdout or "").strip().splitlines()
    for line in url:
        if line.startswith("http"):
            return line.strip()
    raise SystemExit("no mcp url: " + (out.stderr or "")[:200])


def call(name, **args):
    url = mcp_url()
    npx = shutil.which("npx") or shutil.which("npx.cmd") or "npx.cmd"
    cmd = [npx, "-y", "mcporter", "call", "--http-url", url, name]
    cmd += [f"{k}={v}" for k, v in args.items()]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180, cwd=PROJECT)
    if r.returncode != 0:
        raise SystemExit(f"{name} failed: {r.stderr[:300]}")
    txt = r.stdout.strip()
    try:
        return json.loads(txt)
    except Exception:
        return txt


if __name__ == "__main__":
    post = call("wp_get_post", ID="10907")
    content = post.get("post_content") if isinstance(post, dict) else None
    if not content:
        print("keys:", list(post.keys()) if isinstance(post, dict) else type(post))
        raise SystemExit("no content")
    open(os.path.join(PROJECT, "post10907.html"), "w", encoding="utf-8").write(content)
    print("content length:", len(content))
    idx = content.lower().find("install")
    print("--- around 'install' ---")
    print(content[max(0, idx - 500): idx + 700])
