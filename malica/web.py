"""WSGI entry point and request routing."""
import json
import time
import urllib.parse

from . import config
from .admin import _admin_api
from .api import handle_post
from .auth import _PIN_FAILS, _group_from_cookie, _sign
from .config import LOCK
from .domain import find_day, text
from .pages import _pin_page
from .storage import _now, group_by_pin, load, log_line, save
from .web_util import _json, _read_body, _static
from .wolt import wolt_basket_payload, wolt_menu, wolt_venues

def application(environ, start_response):
    path = environ.get("PATH_INFO", "/") or "/"
    method = environ.get("REQUEST_METHOD", "GET")
    parts = [p for p in path.split("/") if p]

    if path in ("/icon.svg", "/apple-touch-icon.png", "/manifest.json", "/og.png", "/privacy.html", "/wolt-logo.png", "/app.css", "/qr.js") or path.startswith("/js/") and method == "GET":
        return _static(start_response, path)

    # ---- vstop s config.PIN-om skupine
    if path == "/pin" and method == "POST":
        ip = environ.get("HTTP_X_REAL_IP") or environ.get("REMOTE_ADDR", "?")
        fails = _PIN_FAILS.get(ip, [0, 0])
        if fails[1] > time.time():
            return _pin_page(start_response, "Preveč poskusov — počakaj minuto")
        try:
            form = urllib.parse.parse_qs(_read_body(environ, 4096).decode("utf-8", "replace"))
        except ValueError:
            return _pin_page(start_response, "Napačen config.PIN")
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
        return _pin_page(start_response, "Napačen config.PIN")

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
            return _json(start_response, {"error": "Potreben je config.PIN — osveži stran"}, "401 Unauthorized")
        return _pin_page(start_response)
    gid = group["id"]

    if method == "GET":
        if parts == ["api", "state"]:
            with LOCK:
                st = load(gid)
            st["group"] = {"id": gid, "name": group["name"]}
            st["admin"] = bool(config.ADMIN_PIN)
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
            state["admin"] = bool(config.ADMIN_PIN)
            state["today"] = _now().strftime("%Y-%m-%d")
            return _json(start_response, state)

    start_response("405 Method Not Allowed", [("Content-Type", "text/plain")])
    return [b"Method not allowed"]
