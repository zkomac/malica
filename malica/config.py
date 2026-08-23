"""Runtime configuration: paths, environment-driven settings and shared locks.

Values are read once at import time. ``DATA_DIR`` is a module attribute on purpose —
tests point it at a temporary directory.
"""
import os
import threading


try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Europe/Ljubljana")
except Exception:  # brez baze časovnih pasov
    TZ = None

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(BASE, "static")
DATA_DIR = os.path.join(BASE, "data")
LEGACY_DATA = os.path.join(BASE, "data.json")
LOCK = threading.RLock()
MAX_VERSIONS = 300

PIN = os.environ.get("MALICA_PIN", "").strip()            # začetni PIN prve skupine (migracija)
ADMIN_PIN = os.environ.get("MALICA_ADMIN_PIN", "").strip()  # prazno = admin izklopljen
EXT_URL = os.environ.get("MALICA_EXT_URL", "").strip()      # povezava na Chrome Web Store (prazno = skrij opombo)

# Privzeta lokacija za nove skupine: MALICA_DEFAULT_LOCATION="lat,lon,Oznaka" (lahko se spremeni v aplikaciji)
def _default_location():
    raw = os.environ.get("MALICA_DEFAULT_LOCATION", "").strip()
    try:
        lat, lon, label = raw.split(",", 2)
        return {"lat": float(lat), "lon": float(lon), "label": label.strip()[:80]}
    except ValueError:
        return {"lat": 46.0511, "lon": 14.5051, "label": "Ljubljana"}


DEFAULT_LOCATION = _default_location()
