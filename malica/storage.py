"""Persistence: groups registry, per-group state files, version history and change log.

Everything is plain JSON on disk, written atomically (tmp + rename). Every ``save()``
keeps a copy of the previous state in ``<gid>.history/`` so the admin can roll back.
"""
import glob
import hmac
import json
import os
import shutil
from datetime import datetime

from . import config
from .config import TZ

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
    return os.path.join(config.DATA_DIR, "groups.json")


def load_groups():
    os.makedirs(config.DATA_DIR, exist_ok=True)
    if os.path.exists(groups_file()):
        with open(groups_file(), encoding="utf-8") as f:
            return json.load(f)
    # prva uporaba: migracija starega data.json v prvo skupino
    g = {"groups": [{"id": "proplus", "name": "Pro Plus", "pin": config.PIN or "0000", "created": _now().isoformat(timespec="seconds")}]}
    if os.path.exists(config.LEGACY_DATA) and not os.path.exists(data_path("proplus")):
        os.replace(config.LEGACY_DATA, data_path("proplus"))
    save_groups(g)
    return g


def save_groups(g):
    os.makedirs(config.DATA_DIR, exist_ok=True)
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
    return os.path.join(config.DATA_DIR, gid + ".json")


def default_state():
    return {"people": [], "days": [], "location": dict(config.DEFAULT_LOCATION)}


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
        hdir = os.path.join(config.DATA_DIR, gid + ".history")
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
    state.setdefault("location", dict(config.DEFAULT_LOCATION))
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
    os.makedirs(config.DATA_DIR, exist_ok=True)
    p = data_path(gid)
    if os.path.exists(p):
        hdir = os.path.join(config.DATA_DIR, gid + ".history")
        os.makedirs(hdir, exist_ok=True)
        stamp = _now().strftime("%Y%m%d-%H%M%S-%f")
        try:  # KOPIJA (ne premik) — živa datoteka nikoli ne izgine, tudi če proces umre
            shutil.copy2(p, os.path.join(hdir, stamp + ".json"))
        except OSError:
            pass
        old = sorted(glob.glob(os.path.join(hdir, "*.json")))
        for f in old[:-config.MAX_VERSIONS]:
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
    logp = os.path.join(config.DATA_DIR, gid + ".log.jsonl")
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
    p = os.path.join(config.DATA_DIR, gid + ".log.jsonl")
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
    hdir = os.path.join(config.DATA_DIR, gid + ".history")
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
