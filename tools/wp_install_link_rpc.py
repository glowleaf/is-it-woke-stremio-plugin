"""Add a real one-click Stremio install link to blog post 10907 (direct JSON-RPC, no shell).

Why JSON-RPC directly: passing HTML through mcporter's key=value CLI got mangled by the Windows
shell ("< was unexpected at this time"). A JSON body over HTTP has no quoting to break.

Stremio's install deep link = manifest URL with https:// swapped for stremio:// (SDK docs/deep-links).
WordPress KSES strips unknown schemes from href, so the page is verified after writing and the colon
is entity-encoded as a fallback.
"""
import json
import os
import subprocess
import sys
import urllib.request

VAULT = r"C:\Users\alpha\machinegeorge\tools\vault_lookup.py"
PROJECT = r"C:\Users\alpha\machinegeorge\stremio-woke"
POST_ID = 10907
MANIFEST = "https://scrut.greekai.gr/woke/eyJ2IjoyfQ/manifest.json"
DEEP = MANIFEST.replace("https://", "stremio://")
PUBLIC = "https://georgesaoulidis.com/woke-score-stremio-addon/"

OLD_LINK = ('<p>Or click to install straight into the app: <a href="//scrut.greekai.gr/woke/eyJ2IjoyfQ/manifest.json">'
            'Install Woke Score in Stremio</a></p>')
OLD_ORDER = ('<p><strong>One thing that matters:</strong> the score row only appears if this addon sits '
             '<strong>above Cinemeta</strong> in your addon list, because Stremio renders whichever metadata '
             'addon answers first. After installing, drag Woke Score to the top of the list on the Addons page.</p>')

NEW_ORDER = (
    '<p><strong>Order only matters for the chips:</strong> the row of score chips next to Genres shows when this '
    'addon sits <strong>above Cinemeta</strong>, because Stremio renders whichever metadata addon answers first '
    '&mdash; and on phones and TVs that chip row is not drawn at all. So the score is also put where order does '
    'not matter: as the first line of the description, as an entry at the top of the sources list, and in the '
    'Discover rows. Install it, put it first if you want the chips, and the rest works either way.</p>'
)


def mcp_url():
    out = subprocess.run([sys.executable, VAULT, "GEORGESAOULIDIS_MCP_URL"], capture_output=True, text=True, timeout=60)
    for line in (out.stdout or "").splitlines():
        if line.startswith("http"):
            return line.strip()
    raise SystemExit("no mcp url: " + (out.stderr or "")[:300])


def rpc(name, arguments, timeout=180):
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": name, "arguments": arguments}}
    req = urllib.request.Request(
        mcp_url(),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json, application/json-rpc",
                 "Accept": "application/json, text/event-stream",
                 "User-Agent": "hermes-agent-mcp/1.0"},
        method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        raw = res.read().decode("utf-8", "ignore")
    if raw.lstrip().startswith("event:") or "\ndata:" in raw:
        raw = "".join(line[5:].strip() for line in raw.splitlines() if line.startswith("data:"))
    body = json.loads(raw)
    if "error" in body:
        raise SystemExit(f"{name} error: {str(body['error'])[:300]}")
    result = body.get("result", {})
    content = result.get("content") if isinstance(result, dict) else None
    if isinstance(content, list) and content:
        text = content[0].get("text", "")
        try:
            return json.loads(text)
        except Exception:
            return {"text": text}
    return result


def fetch_public():
    req = urllib.request.Request(PUBLIC, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    return urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "ignore")


def link_block(deep):
    return (
        f'<p style="text-align:center;margin:28px 0 10px"><a href="{deep}" '
        'style="display:inline-block;padding:16px 30px;border-radius:12px;background:#7b5cff;color:#fff;'
        'font-weight:700;font-size:18px;text-decoration:none">Install in Stremio</a></p>\n'
        '<p style="text-align:center">Nothing opens? <a href="https://scrut.greekai.gr/woke/install">'
        'Use the install page</a> &mdash; it works on phones and TVs too, and it carries the URL to paste '
        'if the app is on another device.</p>'
    )


def main():
    post = rpc("wp_get_post", {"ID": str(POST_ID)})
    content = post.get("post_content") or post.get("content") or post.get("text") or ""
    if not content:
        print("unexpected get_post shape:", json.dumps(post)[:400])
        return 1
    open(os.path.join(PROJECT, "post10907.before.html"), "w", encoding="utf-8").write(content)

    new = content
    if OLD_LINK in new:
        new = new.replace(OLD_LINK, link_block(DEEP))
        print("replaced the dead install link")
    elif "stremio://" not in new:
        new = new.replace("<h2>Install it (about 30 seconds)</h2>",
                          "<h2>Install it (about 30 seconds)</h2>\n" + link_block(DEEP))
        print("inserted the install button under the heading")
    if OLD_ORDER in new:
        new = new.replace(OLD_ORDER, NEW_ORDER)
        print("corrected the 'must be above Cinemeta' paragraph")

    if new == content:
        print("content unchanged - nothing to push")
    else:
        res = rpc("wp_update_post", {"ID": str(POST_ID), "fields": {"post_content": new}})
        print("update:", json.dumps(res)[:220])

    page = fetch_public()
    alive = "stremio://scrut.greekai.gr" in page
    print("deep link alive in public HTML:", alive)
    if not alive:
        print("scheme stripped by the editor - retrying with an entity-encoded colon")
        enc = new.replace(link_block(DEEP), link_block(DEEP.replace("stremio://", "stremio&#58;//")))
        res = rpc("wp_update_post", {"ID": str(POST_ID), "fields": {"post_content": enc}})
        print("update2:", json.dumps(res)[:220])
        page = fetch_public()
        print("encoded colon present:", "stremio&#58;//" in page, "| decoded href present:", "stremio://scrut" in page)
    print("install page linked:", "woke/install" in page)
    return 0


if __name__ == "__main__":
    sys.exit(main())
