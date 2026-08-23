"""Malica — skupinsko naročanje (WSGI, samo standardna knjižnica).

- lokalno:   python server.py
- strežnik:  gunicorn app:application   (1 worker, več niti)

Skupine: vsaka ima svoj PIN in svoje podatke (data/<id>.json). PIN ob vstopu
določi skupino. Admin (MALICA_ADMIN_PIN) vidi vse skupine, dnevnik sprememb in
lahko obnovi prejšnjo različico.
"""
import glob
import hashlib
import hmac
import json
import mimetypes
import os
import re
import shutil
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, datetime

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Europe/Ljubljana")
except Exception:  # brez baze časovnih pasov
    TZ = None

BASE = os.path.dirname(os.path.abspath(__file__))
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


# ---------------------------------------------------------------- skupine
def _eq(a, b):
    """Varna primerjava nizov (hmac.compare_digest vrže TypeError na ne-ASCII str)."""
    try:
        return hmac.compare_digest(str(a).encode("utf-8"), str(b).encode("utf-8"))
    except Exception:
        return False


def _now():
    return datetime.now(TZ) if TZ else datetime.now()


def groups_file():
    return os.path.join(DATA_DIR, "groups.json")


def load_groups():
    os.makedirs(DATA_DIR, exist_ok=True)
    if os.path.exists(groups_file()):
        with open(groups_file(), encoding="utf-8") as f:
            return json.load(f)
    # prva uporaba: migracija starega data.json v prvo skupino
    g = {"groups": [{"id": "proplus", "name": "Pro Plus", "pin": PIN or "0000", "created": _now().isoformat(timespec="seconds")}]}
    if os.path.exists(LEGACY_DATA) and not os.path.exists(data_path("proplus")):
        os.replace(LEGACY_DATA, data_path("proplus"))
    save_groups(g)
    return g


def save_groups(g):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = groups_file() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(g, f, ensure_ascii=False, indent=2)
    os.replace(tmp, groups_file())


def find_group(gid):
    return next((x for x in load_groups()["groups"] if x["id"] == gid), None)


def group_by_pin(pin):
    for x in load_groups()["groups"]:
        if _eq(x["pin"], pin):
            return x
    return None


def data_path(gid):
    return os.path.join(DATA_DIR, gid + ".json")


def default_state():
    return {"people": [], "days": [], "location": dict(DEFAULT_LOCATION)}


def _read_state_file(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def load(gid):
    p = data_path(gid)
    if not os.path.exists(p):
        return default_state()
    try:
        state = _read_state_file(p)
    except (ValueError, OSError):
        # Pokvarjena datoteka (npr. prekinjen zapis): obnovi iz zadnje veljavne različice.
        state = None
        hdir = os.path.join(DATA_DIR, gid + ".history")
        for hf in sorted(glob.glob(os.path.join(hdir, "*.json")), reverse=True):
            try:
                state = _read_state_file(hf)
                break
            except (ValueError, OSError):
                continue
        if state is not None:  # zapiši nazaj veljavno stanje samo ob dejanski obnovi
            try:
                save(gid, state, "sistem", "obnovljeno stanje po okvari datoteke")
            except Exception:
                pass
        else:
            state = default_state()
    if not isinstance(state, dict):
        state = default_state()
    state.setdefault("location", dict(DEFAULT_LOCATION))
    state.setdefault("people", [])
    state.setdefault("days", [])
    for d in state["days"]:
        d.setdefault("orders", [])
        d.setdefault("paid", [])
        d.setdefault("fees", {})
        for k in ("delivery", "service", "tip", "discount"):
            d["fees"].setdefault(k, 0)
        d.setdefault("feeSplit", "proportional")
        d.setdefault("payer", "")
        d.setdefault("orderer", "")
        d.setdefault("status", "open")
        d.setdefault("date", "")
    return state


def save(gid, state, who="", summary=""):
    """Shrani stanje; prej shrani prejšnjo različico in zapiše dnevnik."""
    os.makedirs(DATA_DIR, exist_ok=True)
    p = data_path(gid)
    if os.path.exists(p):
        hdir = os.path.join(DATA_DIR, gid + ".history")
        os.makedirs(hdir, exist_ok=True)
        stamp = _now().strftime("%Y%m%d-%H%M%S-%f")
        try:  # KOPIJA (ne premik) — živa datoteka nikoli ne izgine, tudi če proces umre
            shutil.copy2(p, os.path.join(hdir, stamp + ".json"))
        except OSError:
            pass
        old = sorted(glob.glob(os.path.join(hdir, "*.json")))
        for f in old[:-MAX_VERSIONS]:
            try:
                os.remove(f)
            except OSError:
                pass
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)
    if summary:
        log_line(gid, who, summary)


def log_line(gid, who, summary):
    """Doda vrstico v dnevnik skupine (viden v adminu)."""
    logp = os.path.join(DATA_DIR, gid + ".log.jsonl")
    with open(logp, "a", encoding="utf-8") as f:
        f.write(json.dumps({"ts": _now().isoformat(timespec="seconds"), "who": who or "?", "text": summary}, ensure_ascii=False) + "\n")
    try:  # omeji rast dnevnika
        if os.path.getsize(logp) > 1_000_000:
            with open(logp, encoding="utf-8") as f:
                tail = f.readlines()[-1000:]
            with open(logp + ".tmp", "w", encoding="utf-8") as f:
                f.writelines(tail)
            os.replace(logp + ".tmp", logp)
    except OSError:
        pass


def read_log(gid, limit=200):
    p = os.path.join(DATA_DIR, gid + ".log.jsonl")
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as f:
        lines = f.readlines()[-limit:]
    out = []
    for ln in lines:
        try:
            out.append(json.loads(ln))
        except ValueError:
            pass
    return list(reversed(out))


def list_versions(gid, limit=60):
    hdir = os.path.join(DATA_DIR, gid + ".history")
    files = sorted(glob.glob(os.path.join(hdir, "*.json")), reverse=True)[:limit]
    out = []
    for f in files:
        try:
            with open(f, encoding="utf-8") as fh:
                st = json.load(fh)
            out.append({"id": os.path.basename(f)[:-5], "days": len(st.get("days", [])),
                        "orders": sum(len(d.get("orders", [])) for d in st.get("days", [])),
                        "people": len(st.get("people", []))})
        except (ValueError, OSError):
            pass
    return out


def find_day(state, day_id):
    for d in state["days"]:
        if d["id"] == day_id:
            return d
    return None


def money(v):
    if isinstance(v, str):
        v = v.replace(",", ".").strip()
    try:
        return round(float(v or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def text(v, limit=300):
    return ("" if v is None else str(v)).strip()[:limit]


def is_wolt_url(u):
    return u == "" or re.match(r"^https://(www\.)?wolt\.com/", u) is not None


def deadline_passed(day):
    m = re.match(r"^(\d{1,2}):(\d{2})$", day.get("deadline") or "")
    if not m or not day.get("date"):
        return False
    try:
        due = datetime.strptime(day["date"], "%Y-%m-%d").replace(hour=int(m.group(1)), minute=int(m.group(2)))
    except ValueError:
        return False
    return _now().replace(tzinfo=None) >= due


def day_label(day):
    return "%s (%s)" % (day.get("restaurant", "?"), day.get("date", "?"))


def handle_post(state, parts, body, who):
    """Vrne opis spremembe (za dnevnik) ali None, če pot ne obstaja."""
    if parts == ["api", "people"]:
        name = text(body.get("name"), 60)
        if not name:
            raise ValueError("Ime je obvezno")
        if name not in state["people"]:
            state["people"].append(name)
            return "dodal/a osebo %s" % name
        return ""

    if parts == ["api", "people", "delete"]:
        name = body.get("name")
        state["people"] = [p for p in state["people"] if p != name]
        return "odstranil/a osebo %s" % name

    if parts == ["api", "location"]:
        try:
            state["location"] = {"lat": float(body.get("lat")), "lon": float(body.get("lon")),
                                 "label": text(body.get("label"), 80) or "Pisarna"}
        except (TypeError, ValueError):
            raise ValueError("Neveljavna lokacija")
        return "spremenil/a lokacijo na %s" % state["location"]["label"]

    if parts == ["api", "days"]:
        restaurant = text(body.get("restaurant"))
        if not restaurant:
            raise ValueError("Restavracija je obvezna")
        d = text(body.get("date")) or date.today().isoformat()
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
            raise ValueError("Neveljaven datum")
        url = text(body.get("url"), 500)
        if not is_wolt_url(url):
            raise ValueError("Neveljavna povezava")
        venue = body.get("venue") if isinstance(body.get("venue"), dict) else None
        if venue and not is_wolt_url(text(venue.get("url"), 500)):
            venue["url"] = ""
        day = {
            "id": uuid.uuid4().hex[:8], "date": d, "restaurant": restaurant, "url": url,
            "proposedBy": text(body.get("proposedBy")), "deadline": text(body.get("deadline"), 40),
            "venue": venue, "orderer": text(body.get("orderer") or body.get("proposedBy")),
            "status": "open", "orders": [],
            "fees": {"delivery": 0, "service": 0, "tip": 0, "discount": 0},
            "feeSplit": "proportional", "payer": "", "paid": [],
        }
        state["days"].append(day)
        return "predlagal/a %s" % day_label(day)

    if len(parts) >= 3 and parts[:2] == ["api", "days"]:
        day = find_day(state, parts[2])
        if not day:
            return None
        action = parts[3] if len(parts) > 3 else "update"

        if action == "update":
            changes = []
            for k in ("restaurant", "proposedBy", "deadline", "payer", "orderer"):
                if k in body and text(body[k]) != day.get(k):
                    day[k] = text(body[k]); changes.append(k)
            if "date" in body and re.match(r"^\d{4}-\d{2}-\d{2}$", text(body["date"])) and text(body["date"]) != day["date"]:
                day["date"] = text(body["date"]); changes.append("datum")
            if "url" in body and is_wolt_url(text(body["url"], 500)):
                day["url"] = text(body["url"], 500)
            if body.get("status") in ("open", "ordered") and body["status"] != day["status"]:
                day["status"] = body["status"]; changes.append("zaključil/a naročilo" if body["status"] == "ordered" else "ponovno odprl/a")
            if body.get("feeSplit") in ("equal", "proportional"):
                day["feeSplit"] = body["feeSplit"]
            if isinstance(body.get("fees"), dict):
                for k in day["fees"]:
                    day["fees"][k] = money(body["fees"].get(k, day["fees"][k]))
                changes.append("stroški")
            if "grandTotal" in body:
                day["grandTotal"] = money(body["grandTotal"])
                changes.append("skupni znesek")
            if isinstance(body.get("paid"), list):
                day["paid"] = [text(x) for x in body["paid"] if isinstance(x, str)]
                changes.append("poravnano")
            return ("uredil/a %s: %s" % (day_label(day), ", ".join(changes))) if changes else ""

        if action == "delete":
            state["days"] = [x for x in state["days"] if x["id"] != day["id"]]
            return "IZBRISAL/A dan %s z %d naročili" % (day_label(day), len(day["orders"]))

        if action in ("orders", "orders-delete") and day.get("status") == "ordered":
            raise ValueError("Naročilo je že zaključeno — najprej ga ponovno odpri")
        if action in ("orders", "orders-delete") and day.get("date") != _now().strftime("%Y-%m-%d"):
            raise ValueError("Naročanje je mogoče samo na dan kosila (%s)" % day.get("date"))
        if action in ("orders", "orders-delete") and deadline_passed(day):
            raise ValueError("Rok za naročila (%s) je potekel — kdor naroča, ga lahko podaljša v „Uredi dan“" % day["deadline"])

        if action == "orders":
            person = text(body.get("person"), 60)
            item = text(body.get("item"))
            if not person or not item:
                raise ValueError("Oseba in jed sta obvezni")
            if person not in state["people"]:
                state["people"].append(person)
            order = None
            if body.get("id"):
                order = next((o for o in day["orders"] if o["id"] == body["id"]), None)
            new = order is None
            if new:
                order = {"id": uuid.uuid4().hex[:8]}
                day["orders"].append(order)
            order.update({
                "person": person, "item": item, "price": money(body.get("price")),
                "qty": max(1, min(50, int(money(body.get("qty")) or 1))),
                "note": text(body.get("note")), "options": text(body.get("options"), 600),
                "itemId": text(body.get("itemId"), 64),
                "basePrice": money(body.get("basePrice")) if body.get("basePrice") is not None else money(body.get("price")),
                "opts": [{"id": text(o.get("id"), 64), "values": [{"id": text(v.get("id"), 64), "price": money(v.get("price"))}
                                                                  for v in o.get("values", []) if isinstance(v, dict)]}
                         for o in (body.get("opts") or []) if isinstance(o, dict)][:30],
            })
            return "%s naročilo za %s: %d× %s (%s)" % ("dodal/a" if new else "uredil/a", person, order["qty"], item, day_label(day))

        if action == "orders-delete":
            o = next((o for o in day["orders"] if o["id"] == body.get("id")), None)
            day["orders"] = [x for x in day["orders"] if x["id"] != body.get("id")]
            return ("IZBRISAL/A naročilo %s: %s (%s)" % (o["person"], o["item"], day_label(day))) if o else ""

    return None


# ---------------------------------------------------------------- Wolt API
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


# ---------------------------------------------------------------- WSGI
def _json(start_response, obj, status="200 OK"):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    start_response(status, [("Content-Type", "application/json; charset=utf-8"),
                            ("Content-Length", str(len(body))), ("Cache-Control", "no-store")])
    return [body]


def _static(start_response, path):
    if path in ("", "/") or path.startswith("/order/") or path.startswith("/o/"):
        path = "/index.html"
    full = os.path.normpath(os.path.join(STATIC, path.lstrip("/")))
    try:
        safe = os.path.commonpath([full, STATIC]) == STATIC
    except ValueError:
        safe = False
    if not safe or not os.path.isfile(full):
        start_response("404 Not Found", [("Content-Type", "text/plain; charset=utf-8")])
        return [b"Ni najdeno"]
    ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
    if ctype.startswith("text/"):
        ctype += "; charset=utf-8"
    with open(full, "rb") as f:
        data = f.read()
    start_response("200 OK", [("Content-Type", ctype), ("Content-Length", str(len(data)))])
    return [data]


# ---------- PIN / seje
_SECRET_FILE = os.path.join(BASE, ".secret")


def _secret():
    try:
        with open(_SECRET_FILE, "rb") as f:
            return f.read().strip()
    except OSError:
        sec = uuid.uuid4().hex.encode()
        try:
            with open(_SECRET_FILE, "wb") as f:
                f.write(sec)
            os.chmod(_SECRET_FILE, 0o600)
        except OSError:
            pass
        return sec


def _sign(msg):
    return hmac.new(_secret(), msg.encode("utf-8"), hashlib.sha256).hexdigest()


def _cookies(environ):
    out = {}
    for part in environ.get("HTTP_COOKIE", "").split(";"):
        k, _, v = part.strip().partition("=")
        if k:
            out[k] = v
    return out


def _group_from_cookie(environ):
    """Vrne skupino iz piškotka malica_g=<gid>.<podpis(gid+pin)>."""
    c = _cookies(environ).get("malica_g", "")
    gid, _, sig = c.partition(".")
    if not gid:
        return None
    g = find_group(gid)
    if g and _eq(sig, _sign(gid + ":" + g["pin"])):
        return g
    return None


def _is_admin(environ):
    if not ADMIN_PIN:
        return False
    tok = environ.get("HTTP_X_ADMIN", "")
    return _eq(tok, _sign("admin:" + ADMIN_PIN))


PIN_PAGE = """<!doctype html><html lang="sl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Malica — skupinsko naročanje kosila</title>
<link rel="icon" type="image/svg+xml" href="/icon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:title" content="Malica — skupinsko naročanje kosila">
<meta property="og:description" content="Ekipa skupaj naroči kosilo prek Wolta: vsak izbere svojo jed, eden naroči, aplikacija razdeli ceno.">
<meta property="og:image" content="https://malica.stavio.net/og.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="https://malica.stavio.net/">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#009de0">
<style>body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;color:#202125;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.wrap{width:340px;text-align:center}
.logo{color:#009de0;font-size:2.6rem;font-weight:800;letter-spacing:-.03em;line-height:1}
.tag{color:#202125;font-size:1.05rem;font-weight:600;margin:14px 0 4px}
.lead{color:#717173;font-size:.95rem;line-height:1.45;margin:0 0 4px}
.steps{list-style:none;padding:0;margin:16px 0 20px;text-align:left}
.steps li{display:flex;gap:10px;align-items:flex-start;margin:8px 0;color:#4b5563;font-size:.92rem}
.steps .n{flex:0 0 22px;height:22px;border-radius:50%;background:#e6f5fc;color:#009de0;font-weight:700;font-size:.8rem;display:flex;align-items:center;justify-content:center}
.pinlbl{color:#717173;font-size:.85rem;margin:0 0 8px}
input{width:100%;box-sizing:border-box;font-size:1.3rem;text-align:center;letter-spacing:.3em;padding:12px;border:1px solid #e4e4e5;border-radius:8px}
button{width:100%;margin-top:10px;padding:12px;background:#009de0;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer}
.err{color:#e0453a;font-size:.9rem;margin-top:10px}
.foot{color:#a3a3a3;font-size:.78rem;margin-top:18px}
.extnote{background:#eef8fc;border:1px solid #cfeaf7;border-radius:10px;padding:12px 14px;margin:16px 0 0;font-size:.85rem;color:#333;line-height:1.45;text-align:left}
.extbtn{display:inline-block;margin-top:8px;background:#009de0;color:#fff;padding:8px 14px;border-radius:8px;font-weight:600;text-decoration:none;font-size:.85rem}
.woltbox{margin:18px 0 0;padding:18px 16px 20px;border:1px solid #e4e4e5;border-radius:12px;text-align:center;background:#fff}
.woltbox .sub{font-size:.84rem;color:#717173;line-height:1.5;margin:10px 0 14px}
.woltlogo{display:flex;justify-content:center;align-items:center}
.woltbtn{display:inline-block;background:#fff;color:#009de0;border:2px solid #009de0;padding:11px 26px;border-radius:10px;font-weight:700;text-decoration:none;font-size:.95rem}
.woltbtn:hover{background:#eef8fc}
@media (max-width:640px){ .extnote{display:none} }</style></head><body>
<div class="wrap">
  <div class="logo">🍴 malica</div>
  <div class="tag">Skupaj naročimo malico prek Wolta</div>
  <p class="lead">Brez zbiranja naročil po chatu — vsi izberejo na enem mestu, eden naroči.</p>
  <ol class="steps">
    <li><span class="n">1</span><div>Nekdo predlaga restavracijo.</div></li>
    <li><span class="n">2</span><div>Vsak si izbere, kaj bo jedel.</div></li>
    <li><span class="n">3</span><div>Eden naroči na Woltu, Malica pa izračuna, kdo komu koliko dolguje.</div></li>
  </ol>
  <form method="post" action="/pin">
    <div class="pinlbl">PIN tvoje skupine</div>
    <input name="pin" type="password" inputmode="numeric" autofocus autocomplete="one-time-code">
    <button>Vstopi</button>__ERR__
  </form>
  __EXT__
  <div class="woltbox">
    <div class="woltlogo"><img src="/wolt-logo.png" alt="Wolt" height="34"></div>
    <div class="sub">Tisti, ki naroča, odda skupno naročilo s svojim Wolt računom. Prijavi se na Woltu v novem zavihku in se potem vrni sem.</div>
    <a class="woltbtn" href="https://wolt.com/sl/login" target="_blank" rel="noopener">Prijava v Wolt ↗</a>
  </div>
  <div class="foot">Samo za tvoje sodelavce — noter prideš s PIN-om. Malica ni povezana z Woltom.</div>
</div></body></html>"""

EXT_NOTE = """<div class="extnote">💻 <b>Na računalniku (Chrome ali Edge):</b> namesti razširitev <b>Malica ↔ Wolt</b> — kdor naroča, z enim klikom prenese vse jedi v svojo Wolt košarico.<br><a class="extbtn" href="%s" target="_blank" rel="noopener">Namesti razširitev ↗</a></div>"""

_PIN_FAILS = {}  # ip -> [count, until]


def _pin_page(start_response, error=""):
    page = PIN_PAGE.replace("__ERR__", '<div class="err">%s</div>' % error if error else "")
    page = page.replace("__EXT__", (EXT_NOTE % EXT_URL) if EXT_URL else "")
    body = page.encode("utf-8")
    start_response("200 OK", [("Content-Type", "text/html; charset=utf-8"), ("Content-Length", str(len(body)))])
    return [body]


def _read_body(environ, limit=1_000_000):
    try:
        n = int(environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        n = 0
    if n > limit:
        raise ValueError("Prevelika zahteva")
    return environ["wsgi.input"].read(n) if n else b""


def _admin_api(environ, start_response, parts, method, body):
    """/api/admin/... — samo z veljavnim admin žetonom."""
    if parts == ["api", "admin", "login"] and method == "POST":
        ip = environ.get("HTTP_X_REAL_IP") or environ.get("REMOTE_ADDR", "?")
        fails = _PIN_FAILS.get("admin:" + ip, [0, 0])
        if fails[1] > time.time():
            return _json(start_response, {"error": "Preveč poskusov — počakaj minuto"}, "429 Too Many Requests")
        if ADMIN_PIN and _eq(text(body.get("pin"), 64), ADMIN_PIN):
            _PIN_FAILS.pop("admin:" + ip, None)
            return _json(start_response, {"token": _sign("admin:" + ADMIN_PIN)})
        fails[0] += 1
        if fails[0] >= 5:
            fails = [0, time.time() + 60]
        _PIN_FAILS["admin:" + ip] = fails
        time.sleep(0.5)
        return _json(start_response, {"error": "Napačna admin koda" if ADMIN_PIN else "Admin ni vklopljen (MALICA_ADMIN_PIN)"}, "401 Unauthorized")

    if not _is_admin(environ):
        return _json(start_response, {"error": "Ni dovoljenja"}, "403 Forbidden")

    with LOCK:
        if parts == ["api", "admin", "groups"] and method == "GET":
            out = []
            for g in load_groups()["groups"]:
                st = load(g["id"])
                log = read_log(g["id"], 1)
                out.append({**g, "people": st["people"], "days": len(st["days"]), "location": st["location"]["label"],
                            "last": log[0]["ts"] if log else ""})
            return _json(start_response, {"groups": out, "active": _group_from_cookie(environ) and _group_from_cookie(environ)["id"]})

        if parts == ["api", "admin", "groups"] and method == "POST":
            name = text(body.get("name"), 60)
            pin = text(body.get("pin"), 32)
            if not name or not re.match(r"^\d{4,8}$", pin):
                raise ValueError("Ime in PIN (4–8 številk) sta obvezna")
            groups = load_groups()
            if group_by_pin(pin):
                raise ValueError("Ta PIN že uporablja druga skupina")
            gid = re.sub(r"[^a-z0-9]+", "-", name.lower().replace("č", "c").replace("š", "s").replace("ž", "z")).strip("-") or "skupina"
            base, i = gid, 2
            while find_group(gid):
                gid = "%s-%d" % (base, i); i += 1
            groups["groups"].append({"id": gid, "name": name, "pin": pin, "created": _now().isoformat(timespec="seconds")})
            save_groups(groups)
            save(gid, default_state(), "admin", "ustvaril/a skupino %s" % name)
            return _json(start_response, {"ok": True, "id": gid})

        if len(parts) == 4 and parts[:3] == ["api", "admin", "group"] and method == "POST":
            g = find_group(parts[3])
            if not g:
                return _json(start_response, {"error": "Ni skupine"}, "404 Not Found")
            groups = load_groups()
            for x in groups["groups"]:
                if x["id"] == g["id"]:
                    if text(body.get("name"), 60):
                        x["name"] = text(body.get("name"), 60)
                    if "pin" in body:
                        pin = text(body.get("pin"), 32)
                        if not re.match(r"^\d{4,8}$", pin):
                            raise ValueError("PIN mora imeti 4–8 številk")
                        other = group_by_pin(pin)
                        if other and other["id"] != g["id"]:
                            raise ValueError("Ta PIN že uporablja druga skupina")
                        x["pin"] = pin
            save_groups(groups)
            return _json(start_response, {"ok": True})

        if len(parts) == 5 and parts[:3] == ["api", "admin", "group"] and method == "GET":
            gid, what = parts[3], parts[4]
            if not find_group(gid):
                return _json(start_response, {"error": "Ni skupine"}, "404 Not Found")
            if what == "log":
                return _json(start_response, {"log": read_log(gid)})
            if what == "versions":
                return _json(start_response, {"versions": list_versions(gid)})

        if len(parts) == 5 and parts[:3] == ["api", "admin", "group"] and parts[4] == "removeperson" and method == "POST":
            gid = parts[3]
            name = text(body.get("name"), 60)
            if not find_group(gid):
                return _json(start_response, {"error": "Ni skupine"}, "404 Not Found")
            st = load(gid)
            if name not in st["people"]:
                return _json(start_response, {"error": "Te osebe ni v skupini"}, "404 Not Found")
            st["people"] = [p for p in st["people"] if p != name]
            save(gid, st, "admin", "ODSTRANIL/A osebo %s" % name)
            return _json(start_response, {"ok": True, "people": st["people"]})

        if len(parts) == 5 and parts[:3] == ["api", "admin", "group"] and parts[4] == "restore" and method == "POST":
            gid = parts[3]
            vid = text(body.get("version"), 64)
            f = os.path.join(DATA_DIR, gid + ".history", vid + ".json")
            if not find_group(gid) or not re.match(r"^[0-9-]+$", vid) or not os.path.exists(f):
                return _json(start_response, {"error": "Ni različice"}, "404 Not Found")
            with open(f, encoding="utf-8") as fh:
                st = json.load(fh)
            save(gid, st, "admin", "OBNOVIL/A različico %s" % vid)
            return _json(start_response, {"ok": True})

    return _json(start_response, {"error": "Ni najdeno"}, "404 Not Found")


def application(environ, start_response):
    path = environ.get("PATH_INFO", "/") or "/"
    method = environ.get("REQUEST_METHOD", "GET")
    parts = [p for p in path.split("/") if p]

    if path in ("/icon.svg", "/apple-touch-icon.png", "/manifest.json", "/og.png", "/privacy.html", "/wolt-logo.png") and method == "GET":
        return _static(start_response, path)

    # ---- vstop s PIN-om skupine
    if path == "/pin" and method == "POST":
        ip = environ.get("HTTP_X_REAL_IP") or environ.get("REMOTE_ADDR", "?")
        fails = _PIN_FAILS.get(ip, [0, 0])
        if fails[1] > time.time():
            return _pin_page(start_response, "Preveč poskusov — počakaj minuto")
        try:
            form = urllib.parse.parse_qs(_read_body(environ, 4096).decode("utf-8", "replace"))
        except ValueError:
            return _pin_page(start_response, "Napačen PIN")
        with LOCK:
            g = group_by_pin(form.get("pin", [""])[0].strip())
        if g:
            _PIN_FAILS.pop(ip, None)
            secure = "; Secure" if environ.get("HTTP_X_FORWARDED_PROTO") == "https" else ""
            cookie = "malica_g=%s.%s; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax%s" % (g["id"], _sign(g["id"] + ":" + g["pin"]), secure)
            start_response("303 See Other", [("Location", "/"), ("Set-Cookie", cookie)])
            return [b""]
        fails[0] += 1
        if fails[0] >= 5:
            fails = [0, time.time() + 60]
        _PIN_FAILS[ip] = fails
        time.sleep(0.5)
        return _pin_page(start_response, "Napačen PIN")

    if path == "/logout":
        start_response("303 See Other", [("Location", "/"), ("Set-Cookie", "malica_g=; Path=/; Max-Age=0")])
        return [b""]

    # ---- admin API (ne potrebuje skupinskega piškotka)
    if parts[:2] == ["api", "admin"]:
        body = {}
        if method == "POST":
            try:
                body = json.loads(_read_body(environ).decode("utf-8") or "{}")
            except (ValueError, UnicodeDecodeError):
                return _json(start_response, {"error": "Neveljaven JSON"}, "400 Bad Request")
            if not isinstance(body, dict):
                body = {}
        try:
            return _admin_api(environ, start_response, parts, method, body)
        except ValueError as e:
            return _json(start_response, {"error": str(e)}, "400 Bad Request")

    with LOCK:
        group = _group_from_cookie(environ)
    if not group:
        if path.startswith("/api/"):
            return _json(start_response, {"error": "Potreben je PIN — osveži stran"}, "401 Unauthorized")
        return _pin_page(start_response)
    gid = group["id"]

    if method == "GET":
        if parts == ["api", "state"]:
            with LOCK:
                st = load(gid)
            st["group"] = {"id": gid, "name": group["name"]}
            st["admin"] = bool(ADMIN_PIN)
            st["today"] = _now().strftime("%Y-%m-%d")
            return _json(start_response, st)
        if parts[:3] in (["api", "wolt", "mydays"], ["api", "wolt", "basket"]):
            qs = urllib.parse.parse_qs(environ.get("QUERY_STRING", ""))
            who = text(qs.get("who", [""])[0], 60)
            with LOCK:
                stg = load(gid)
            todayd = _now().strftime("%Y-%m-%d")
            if parts[2] == "mydays":
                days = [{"id": d["id"], "restaurant": d["restaurant"], "date": d["date"], "orders": len(d["orders"]),
                         "status": d["status"], "hasVenue": bool((d.get("venue") or {}).get("id"))}
                        for d in stg["days"] if d["date"] == todayd and d.get("orderer") == who]
                return _json(start_response, {"who": who, "days": days, "people": stg["people"]})
            day = find_day(stg, text(qs.get("dayId", [""])[0], 16))
            if not day:
                return _json(start_response, {"error": "Ni dneva"}, "404 Not Found")
            if not who or day.get("orderer") != who:
                return _json(start_response, {"error": "Košarico lahko prenese samo tisti, ki danes naroča"}, "403 Forbidden")
            try:
                return _json(start_response, wolt_basket_payload(day))
            except ValueError as e:
                return _json(start_response, {"error": str(e)}, "400 Bad Request")
        if parts[:2] == ["api", "wolt"]:
            qs = urllib.parse.parse_qs(environ.get("QUERY_STRING", ""))
            try:
                if parts[2:] == ["venues"]:
                    with LOCK:
                        loc = load(gid)["location"]
                    return _json(start_response, wolt_venues(float(loc["lat"]), float(loc["lon"])))
                if parts[2:] == ["menu"]:
                    slug = qs.get("slug", [""])[0]
                    if not slug:
                        return _json(start_response, {"error": "Manjka slug"}, "400 Bad Request")
                    return _json(start_response, wolt_menu(slug))
            except Exception as e:  # Wolt nedosegljiv / spremenjen API
                return _json(start_response, {"error": "Wolt ni dosegljiv: " + str(e)}, "502 Bad Gateway")
        return _static(start_response, path)

    if method == "POST" and parts[:1] == ["api"]:
        try:
            raw = _read_body(environ)
            body = json.loads(raw.decode("utf-8") or "{}")
        except ValueError as e:
            return _json(start_response, {"error": str(e) if "Prevelika" in str(e) else "Neveljaven JSON"}, "400 Bad Request")
        except UnicodeDecodeError:
            return _json(start_response, {"error": "Neveljaven JSON"}, "400 Bad Request")
        if not isinstance(body, dict):
            return _json(start_response, {"error": "Neveljaven JSON"}, "400 Bad Request")
        who = text(urllib.parse.unquote(environ.get("HTTP_X_WHO", "")), 60)
        if parts == ["api", "wolt", "extlog"]:
            # Dnevnik razširitve Malica ↔ Wolt (uspehi in napake), viden v adminu.
            msg = text(body.get("text"), 300)
            if msg:
                with LOCK:
                    log_line(gid, text(body.get("who"), 60) or who or "razširitev", "[razširitev] " + ("✓ " if body.get("ok") else "✗ NAPAKA: ") + msg)
            return _json(start_response, {"ok": True})
        with LOCK:
            state = load(gid)
            try:
                result = handle_post(state, parts, body, who)
            except ValueError as e:
                return _json(start_response, {"error": str(e)}, "400 Bad Request")
            except (TypeError, AttributeError, KeyError):
                return _json(start_response, {"error": "Neveljavni podatki"}, "400 Bad Request")
            if result is None:
                return _json(start_response, {"error": "Ni najdeno"}, "404 Not Found")
            save(gid, state, who, result)
            state["group"] = {"id": gid, "name": group["name"]}
            state["admin"] = bool(ADMIN_PIN)
            state["today"] = _now().strftime("%Y-%m-%d")
            return _json(start_response, state)

    start_response("405 Method Not Allowed", [("Content-Type", "text/plain")])
    return [b"Method not allowed"]
