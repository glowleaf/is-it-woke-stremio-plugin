"""Add a real one-click Stremio install link to blog post 10907 and verify it survived WordPress.

Stremio's install deep link is the manifest URL with https:// swapped for stremio:// (that is what
the addon directories use). WordPress' KSES filter strips unknown schemes from href, which is why
the existing link came out as "//scrut...". This tries the plain scheme, verifies the public page,
and falls back to an entity-encoded colon if the filter ate it.
"""
import html
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request

VAULT = r"C:\Users\alpha\machinegeorge\tools\vault_lookup.py"
PROJECT = r"C:\Users\alpha\machinegeorge\stremio-woke"
POST_ID = "10907"
MANIFEST = "https://scrut.greekai.gr/woke/eyJ2IjoyfQ/manifest.json"
DEEP = MANIFEST.replace("https://", "stremio://")
PUBLIC = "https://georgesaoulidis.com/woke-score-stremio-addon/"

OLD_LINK = ('<p>Or click to install straight into the app: <a href="//scrut.greekai.gr/woke/eyJ2IjoyfQ/manifest.json">'
            'Install Woke Score in Stremio</a></p>')
OLD_ORDER = ('<p><strong>One thing that matters:</strong> the score row only appears if this addon sits '
             '<strong>above Cinemeta</strong> in your addon list, because Stremio renders whichever metadata '
             'addon answers first. After installing, drag Woke Score to the top of the list on the Addons page.</p>')


def mcp_url():
    out = subprocess.run([sys.executable, VAULT, "GEORGESAOULIDIS_MCP_URL"], capture_output=True, text=True, timeout=60)
    for line in (out.stdout or "").splitlines():
        if line.startswith("http"):
            return line.strip()
    raise SystemExit("no mcp url: " + (out.stderr or "")[:200])


def call(name, **args):
    npx = shutil.which("npx") or shutil.which("npx.cmd") or "npx.cmd"
    cmd = [npx, "-y", "mcporter", "call", "--http-url", mcp_url(), name]
    cmd += [f"{k}={v}" for k, v in args.items()]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180, cwd=PROJECT)
    if r.returncode != 0:
        raise SystemExit(f"{name} failed: {r.stderr[:300]}")
    try:
        return json.loads(r.stdout.strip())
    except Exception:
        return r.stdout


def link_block(deep):
    return (
        f'<p style="text-align:center;margin:28px 0 10px"><a href="{deep}" '
        'style="display:inline-block;padding:16px 30px;border-radius:12px;background:#7b5cff;color:#fff;'
        'font-weight:700;font-size:18px;text-decoration:none">Install in Stremio</a></p>\n'
        '<p style="text-align:center">Nothing opens? <a href="https://scrut.greekai.gr/woke/install">'
        'Use the install page</a> &mdash; it works on phones and TVs too, and it carries the URL to paste '
        'if the app is on another device.</p>'
    )


NEW_ORDER = (
    '<p><strong>Order only matters for the chips:</strong> the row of score chips next to Genres shows when this '
    'addon sits <strong>above Cinemeta</strong>, because Stremio renders whichever metadata addon answers first '
    '&mdash; and on phones and TVs that chip row is not drawn at all. So the score is also put where order does '
    'not matter: as the first line of the description, as an entry at the top of the sources list, and in the '
    'Discover rows. Install it, put it first if you want the chips, and the rest works either way.</p>'
)


def fetch_public():
    req = urllib.request.Request(PUBLIC, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    return urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "ignore")


def main():
    post = call("wp_get_post", ID=POST_ID)
    content = post.get("post_content") or post.get("content") or ""
    if not content:
        raise SystemExit("could not read post content: " + str(list(post))[:200])
    open(os.path.join(PROJECT, "post10907.before.html"), "w", encoding="utf-8").write(content)

    changed = content
    if OLD_LINK in changed:
        changed = changed.replace(OLD_LINK, link_block(DEEP))
    elif "stremio://" not in changed:
        changed = changed.replace("<h2>Install it (about 30 seconds)</h2>",
                                  "<h2>Install it (about 30 seconds)</h2>\n" + link_block(DEEP))
    if OLD_ORDER in changed:
        changed = changed.replace(OLD_ORDER, NEW_ORDER)

    if changed == content:
        print("nothing to change")
    else:
        res = call("wp_update_post", ID=POST_ID, fields=json.dumps({"post_content": changed}, ensure_ascii=False))
        print("update:", json.dumps(res)[:200])

    page = fetch_public()
    alive = "stremio://scrut.greekai.gr" in page
    print("deep link alive on public page:", alive)
    if not alive:
        print("scheme was stripped - retrying with an entity-encoded colon")
        enc = link_block(DEEP.replace("stremio://", "stremio&#58;//"))
        res = call("wp_update_post", ID=POST_ID, fields=json.dumps({"post_content": changed.replace(link_block(DEEP), enc)},
                                                                  ensure_ascii=False))
        print("update2:", json.dumps(res)[:200])
        page = fetch_public()
        print("encoded colon in source:", "stremio&#58;//" in page, "| decoded href present:", "stremio://scrut" in page)
    print("install page linked:", "woke/install" in page)


if __name__ == "__main__":
    main()
