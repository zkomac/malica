"""Admin API (``/api/admin/...``): groups, change log, version restore, people."""
import json
import os
import re
import time

from . import config
from .auth import _PIN_FAILS, _group_from_cookie, _is_admin, _sign
from .config import LOCK
from .domain import text
from .storage import _eq, _now, default_state, find_group, group_by_pin, list_versions, load, load_groups, read_log, save, save_groups
from .web_util import _json

def _admin_api(environ, start_response, parts, method, body):
    """/api/admin/... — samo z veljavnim admin žetonom."""
    if parts == ["api", "admin", "login"] and method == "POST":
        ip = environ.get("HTTP_X_REAL_IP") or environ.get("REMOTE_ADDR", "?")
        fails = _PIN_FAILS.get("admin:" + ip, [0, 0])
        if fails[1] > time.time():
            return _json(start_response, {"error": "Preveč poskusov — počakaj minuto"}, "429 Too Many Requests")
        if config.ADMIN_PIN and _eq(text(body.get("pin"), 64), config.ADMIN_PIN):
            _PIN_FAILS.pop("admin:" + ip, None)
            return _json(start_response, {"token": _sign("admin:" + config.ADMIN_PIN)})
        fails[0] += 1
        if fails[0] >= 5:
            fails = [0, time.time() + 60]
        _PIN_FAILS["admin:" + ip] = fails
        time.sleep(0.5)
        return _json(start_response, {"error": "Napačna admin koda" if config.ADMIN_PIN else "Admin ni vklopljen (MALICA_ADMIN_PIN)"}, "401 Unauthorized")

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
                raise ValueError("Ime in config.PIN (4–8 številk) sta obvezna")
            groups = load_groups()
            if group_by_pin(pin):
                raise ValueError("Ta config.PIN že uporablja druga skupina")
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
                            raise ValueError("config.PIN mora imeti 4–8 številk")
                        other = group_by_pin(pin)
                        if other and other["id"] != g["id"]:
                            raise ValueError("Ta config.PIN že uporablja druga skupina")
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
            f = os.path.join(config.DATA_DIR, gid + ".history", vid + ".json")
            if not find_group(gid) or not re.match(r"^[0-9-]+$", vid) or not os.path.exists(f):
                return _json(start_response, {"error": "Ni različice"}, "404 Not Found")
            with open(f, encoding="utf-8") as fh:
                st = json.load(fh)
            save(gid, st, "admin", "OBNOVIL/A različico %s" % vid)
            return _json(start_response, {"ok": True})

    return _json(start_response, {"error": "Ni najdeno"}, "404 Not Found")
