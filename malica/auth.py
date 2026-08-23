"""Sessions and authentication.

A group session is a cookie ``malica_g=<gid>.<hmac>`` signed with a per-install secret;
the admin token is an HMAC of the admin config.PIN. Comparisons are constant-time and config.PIN
guessing is rate limited per IP.
"""
import hashlib
import hmac
import os
import uuid

from . import config
from .storage import _eq, find_group

_SECRET_FILE = os.environ.get("MALICA_SECRET_FILE", "").strip() or os.path.join(config.BASE, ".secret")


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
    if not config.ADMIN_PIN:
        return False
    tok = environ.get("HTTP_X_ADMIN", "")
    return _eq(tok, _sign("admin:" + config.ADMIN_PIN))

_PIN_FAILS = {}  # ip -> [count, until]
