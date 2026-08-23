"""Wolt client: restaurant discovery, menus and basket payloads.

Wolt has no public API; these are the endpoints its own web app uses. Responses are
cached in memory with a short TTL and refreshed in the background for every group
location, so the UI stays fast even when Wolt is slow.
"""
import json
import re
import threading
import time
import urllib.parse
import urllib.request

from .config import LOCK
from .storage import load, load_groups

WOLT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "sl",
}
_CACHE = {}  # key -> (expires, value)
_CACHE_LOCK = threading.Lock()


_INFLIGHT = {}  # key -> Lock, da več hkratnih zahtev ne kliče Wolta večkrat


def _cached(key, ttl, fn, force=False):
    now = time.time()
    if not force:
        with _CACHE_LOCK:
            hit = _CACHE.get(key)
            if hit and hit[0] > now:
                return hit[1]
    with _CACHE_LOCK:
        lock = _INFLIGHT.setdefault(key, threading.Lock())
    with lock:
        if not force:
            with _CACHE_LOCK:
                hit = _CACHE.get(key)
                if hit and hit[0] > time.time():
                    return hit[1]
        value = fn()
        with _CACHE_LOCK:
            _CACHE[key] = (time.time() + ttl, value)
        return value


def _wolt_get(url):
    req = urllib.request.Request(url, headers=WOLT_HEADERS)
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))


def _img(obj):
    if isinstance(obj, dict):
        return obj.get("url") or ""
    if isinstance(obj, list) and obj:
        return _img(obj[0])
    return ""


def wolt_venues(lat, lon, force=False):
    def fetch():
        url = f"https://restaurant-api.wolt.com/v1/pages/restaurants?lat={lat:.5f}&lon={lon:.5f}"
        data = _wolt_get(url)
        out, seen = [], set()
        for sec in data.get("sections", []):
            for it in sec.get("items", []):
                v = it.get("venue")
                if not isinstance(v, dict) or not v.get("id") or v.get("id") in seen or not v.get("slug"):
                    continue
                seen.add(v["id"])
                rating = v.get("rating") if isinstance(v.get("rating"), dict) else {}
                out.append({
                    "id": v.get("id"),
                    "slug": v.get("slug"),
                    "name": v.get("name"),
                    "description": v.get("short_description") or "",
                    "address": v.get("address") or "",
                    "image": _img(it.get("image")),
                    "tags": v.get("tags") or [],
                    "rating": rating.get("score"),
                    "ratingVolume": rating.get("volume"),
                    "estimate": v.get("estimate_range") or "",
                    "priceRange": v.get("price_range") or 0,
                    "online": bool(v.get("online")),
                    "delivers": bool(v.get("delivers", True)),
                    "url": "https://wolt.com/sl/svn/ljubljana/restaurant/" + str(v.get("slug")),
                })
        filters = []
        for f in (data.get("filtering") or {}).get("filters", []):
            if f.get("id") == "primary":
                filters = [{"id": x.get("id"), "name": x.get("name")} for x in f.get("values", []) if x.get("id") and x.get("name")]
        return {"venues": out, "filters": filters, "city": data.get("city")}
    return _cached(f"venues:{lat:.3f}:{lon:.3f}", 1800, fetch, force)


def wolt_menu(slug):
    def fetch():
        if not re.match(r"^[a-z0-9][a-z0-9-]{0,120}$", slug):
            raise ValueError("Neveljaven slug")
        url = ("https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/"
               + urllib.parse.quote(slug, safe="") + "/assortment?language=sl")
        data = _wolt_get(url)
        options = {}
        def num(x):
            try:
                return (float(x) if x is not None else 0) / 100
            except (TypeError, ValueError):
                return 0.0
        for o in data.get("options", []):
            if not isinstance(o, dict) or not o.get("id"):
                continue
            options[o["id"]] = {
                "id": o["id"],
                "name": o.get("name") or "",
                "type": o.get("type"),
                "values": [{"id": x.get("id"), "name": x.get("name") or "", "price": num(x.get("price"))}
                           for x in o.get("values", []) if isinstance(x, dict) and x.get("id")],
            }
        items = {}
        for it in data.get("items", []):
            if not isinstance(it, dict) or not it.get("id"):
                continue
            opts = []
            for ref in it.get("options", []):
                od = options.get(ref.get("option_id"))
                if not od:
                    continue
                cfg = (ref.get("multi_choice_config") or {}).get("total_range") or {}
                opts.append({**od, "min": cfg.get("min", 0), "max": cfg.get("max", 1)})
            items[it["id"]] = {
                "id": it["id"],
                "name": it.get("name") or "",
                "description": it.get("description") or "",
                "price": num(it.get("price")),
                "image": _img(it.get("images")),
                "disabled": bool(it.get("disabled_info")),
                "options": opts,
            }
        categories = []
        for c in data.get("categories", []):
            if not isinstance(c, dict) or not c.get("id"):
                continue
            cat_items = [items[i] for i in c.get("item_ids", []) if i in items]
            if cat_items:
                categories.append({"id": c["id"], "name": c.get("name") or "", "items": cat_items})
        return {"slug": slug, "categories": categories}
    return _cached("menu:" + slug, 900, fetch)


def wolt_basket_payload(day):
    """Pripravi vsebino Wolt košarice za dan (za razširitev). Ne hrani žetonov."""
    venue = day.get("venue") or {}
    if not venue.get("id"):
        raise ValueError("Ta dan nima povezane Wolt restavracije")
    items, skipped = [], []
    for o in day.get("orders", []):
        if not o.get("itemId") or not re.match(r"^[a-f0-9]{24}$", o["itemId"]):
            skipped.append("%s: %s" % (o["person"], o["item"]))
            continue
        base = o.get("basePrice")
        if base is None:
            base = o["price"]
        opts = []
        for sel in o.get("opts") or []:
            if isinstance(sel, dict) and sel.get("id"):
                opts.append({"id": sel["id"], "values": [{"id": v["id"], "count": 1, "price": int(round(float(v.get("price") or 0) * 100))}
                                                         for v in sel.get("values", []) if isinstance(v, dict) and v.get("id")]})
        items.append({"id": o["itemId"], "count": int(o.get("qty") or 1), "name": o["item"],
                      "price": int(round(float(base) * 100)), "options": opts, "substitution_settings": {"is_allowed": True}})
    return {"venue_id": venue["id"], "venue_url": venue.get("url") or "", "restaurant": day.get("restaurant"),
            "currency": "EUR", "items": items, "skipped": skipped}


def _warm_loop():
    """Vsakih 10 min v ozadju osveži seznam restavracij za vse skupine."""
    while True:
        try:
            with LOCK:
                locs = {(round(load(g["id"])["location"]["lat"], 3), round(load(g["id"])["location"]["lon"], 3))
                        for g in load_groups()["groups"]}
            for lat, lon in locs:
                wolt_venues(lat, lon, force=True)
        except Exception:
            pass
        time.sleep(600)


threading.Thread(target=_warm_loop, daemon=True).start()
