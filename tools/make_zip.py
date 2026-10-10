"""Package the addon source for the blog download link (excludes runtime data + scratch)."""
import os
import zipfile

ROOT = r"C:\Users\alpha\machinegeorge\stremio-woke"
OUT = os.path.join(ROOT, "site-assets", "woke-score-addon.zip")
INCLUDE_DIRS = ["src", "deploy", "tools", "public", "test"]
INCLUDE_FILES = ["package.json", "README.md"]


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    count = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for name in INCLUDE_FILES:
            path = os.path.join(ROOT, name)
            if os.path.isfile(path):
                z.write(path, f"stremio-woke-addon/{name}")
                count += 1
        for d in INCLUDE_DIRS:
            base = os.path.join(ROOT, d)
            for dirpath, _dirnames, filenames in os.walk(base):
                if "data" in dirpath.split(os.sep) or "__pycache__" in dirpath:
                    continue
                for fn in filenames:
                    full = os.path.join(dirpath, fn)
                    rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
                    z.write(full, f"stremio-woke-addon/{rel}")
                    count += 1
    print(f"zip: {OUT} ({os.path.getsize(OUT)} bytes, {count} files)")


if __name__ == "__main__":
    main()
