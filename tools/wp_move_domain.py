"""Point the blog post at the new domain: manifest URL, deep link and install page.

Every reference to scrut.greekai.gr/woke/... becomes metawokecritic.com/..., and one line links to the
index itself. Verified against the public page afterwards.
"""
import json
import subprocess
import sys
import urllib.request

VAULT = r"C:\Users\alpha\machinegeorge\tools\vault_lookup.py"
POST_ID = 10907
PUBLIC = "https://georgesaoulidis.com/woke-score-stremio-addon/"

REPLACEMENTS = [
    ("//scrut.greekai.gr/woke/eyJ2IjoyfQ/manifest.json", "stremio://metawokecritic.com/eyJ2IjoyfQ/manifest.json"),
    ("https://scrut.greekai.gr/woke/eyJ2IjoyfQ/manifest.json", "https://metawokecritic.com/eyJ2IjoyfQ/manifest.json"),
    ("stremio://scrut.greekai.gr/woke/eyJ2IjoyfQ/manifest.json", "stremio://metawokecritic.com/eyJ2IjoyfQ/manifest.json"),
    ("https://scrut.greekai.gr/woke/install", "https://metawokecritic.com/install"),
    ("https://scrut.greekai.gr/woke/configure", "https://metawokecritic.com/configure"),
]


def mcp_url():
    out = subprocess.run([sys.executable, VAULT, "GEORGESAOULIDIS_MCP_URL"], capture_output=True, text=True, timeout=60)
    for line in (out.stdout or "").splitlines():
        if line.startswith("http"):
            return line.strip()
    raise SystemExit("no mcp url: " + (out.stderr or "")[:200])


def rpc(name, arguments, timeout=180):
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}}
    req = urllib.request.Request(
        mcp_url(), data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json, application/json-rpc",
                 "Accept": "application/json, text/event-stream",
                 "User-Agent": "hermes-agent-mcp/1.0"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        raw = res.read().decode("utf-8", "ignore")
    if raw.lstrip().startswith("event:") or "\ndata:" in raw:
        raw = "".join(line[5:].strip() for line in raw.splitlines() if line.startswith("data:"))
    body = json.loads(raw)
    if "error" in body:
        raise SystemExit(f"{name} error: {str(body['error'])[:300]}")
    content = (body.get("result") or {}).get("content")
    if isinstance(content, list) and content:
        text = content[0].get("text", "")
        try:
            return json.loads(text)
        except Exception:
            return {"text": text}
    return body.get("result")


def main():
    post = rpc("wp_get_post", {"ID": str(POST_ID)})
    content = post.get("post_content") or post.get("content") or ""
    if not content:
        raise SystemExit("could not read post")
    new = content
    changed = []
    for old, repl in REPLACEMENTS:
        if old in new:
            new = new.replace(old, repl)
            changed.append(old)

    if "metawokecritic.com\">browse the index" not in new and "metawokecritic.com</a>" not in new:
        marker = "<h2>Install it (about 30 seconds)</h2>"
        if marker in new:
            new = new.replace(marker, marker + "\n<p>Every score is also browsable at "
                              "<a href=\"https://metawokecritic.com/\">metawokecritic.com</a>, with the theme "
                              "breakdown and the script analysis for each title.</p>")

    if new == content:
        print("nothing to change")
    else:
        res = rpc("wp_update_post", {"ID": str(POST_ID), "fields": {"post_content": new}})
        print("updated:", json.dumps(res)[:160])

    page = urllib.request.urlopen(urllib.request.Request(PUBLIC, headers={"User-Agent": "Mozilla/5.0 Chrome/154"}), timeout=40).read().decode("utf-8", "ignore")
    print("new manifest on page:", "metawokecritic.com/eyJ2IjoyfQ/manifest.json" in page)
    print("new install page on page:", "metawokecritic.com/install" in page)
    print("old scrut references left:", page.count("scrut.greekai.gr"))


if __name__ == "__main__":
    main()
