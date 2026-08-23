#!/usr/bin/env python3
"""Build malica-wolt-extension.zip for the Chrome Web Store from extension/."""
import json
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(ROOT, "extension")
OUT = os.path.join(ROOT, "malica-wolt-extension.zip")
FILES = ["manifest.json", "background.js", "content.js", "wolt-content.js", "popup.html", "popup.js", "icon48.png", "icon128.png"]

with open(os.path.join(EXT, "manifest.json"), encoding="utf-8") as f:
    version = json.load(f)["version"]
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for name in FILES:
        z.write(os.path.join(EXT, name), name)
print("wrote %s (v%s, %d bytes)" % (OUT, version, os.path.getsize(OUT)))
