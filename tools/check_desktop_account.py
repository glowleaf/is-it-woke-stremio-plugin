"""Does the desktop app's profile belong to a Stremio account, or is it a local profile?

Reads the WebView2 local-storage leveldb, decodes the stored `profile` value and reports whether
it carries an account user (email) - the thing that decides whether other devices see its addons.
Only reports shape/booleans, never the key itself.
"""
import glob
import json
import os
import re

BASE = os.path.expandvars(r'%LOCALAPPDATA%\Programs\Stremio\stremio-shell-ng.exe.WebView2\EBWebView\Default\Local Storage\leveldb')

blob = b""
for f in glob.glob(os.path.join(BASE, "*")):
    try:
        blob += open(f, "rb").read()
    except OSError:
        pass

i = blob.find(b'_https://web.stremio.com\x00\x01profile')
print("profile record found:", i >= 0)
chunk = blob[i + 34: i + 400000] if i >= 0 else b""

text = None
for enc in ("utf-16-le", "utf-8"):
    for off in range(0, 12):
        try:
            t = chunk[off:].decode(enc, "ignore")
        except Exception:
            continue
        j = t.find('{"auth"')
        if j < 0:
            j = t.find("{")
        if j >= 0 and '"auth"' in t[j:j + 4000]:
            text = t[j:]
            print(f"decoded with {enc} (offset {off})")
            break
    if text:
        break

if not text:
    print("could not decode; raw snippet:")
    print(chunk[:200])
    raise SystemExit

# top-level keys of the profile
m = re.match(r'\{.*?"key"\s*:', text, re.S)
print("auth block snippet:", re.sub(r'"key"\s*:\s*"[^"]*"', '"key":"<redacted>"', text[:300]))

for probe in ('"user"', '"email"', '"facebook"', '"id"', '"provider"'):
    c = text.count(probe)
    print(f"  {probe} occurrences in profile: {c}")

# emails anywhere in the profile region (structure only, masked)
for em in set(re.findall(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', text[:60000])):
    masked = em[0] + "***@" + em.split("@", 1)[1]
    print("  email found in profile:", masked)
