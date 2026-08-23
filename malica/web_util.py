"""WSGI helpers: JSON responses, safe static file serving, request body reading."""
import json
import mimetypes
import os

from . import config

def _json(start_response, obj, status="200 OK"):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    start_response(status, [("Content-Type", "application/json; charset=utf-8"),
                            ("Content-Length", str(len(body))), ("Cache-Control", "no-store")])
    return [body]


def _static(start_response, path):
    if path in ("", "/") or path.startswith("/order/") or path.startswith("/o/"):
        path = "/index.html"
    full = os.path.normpath(os.path.join(config.STATIC, path.lstrip("/")))
    try:
        safe = os.path.commonpath([full, config.STATIC]) == config.STATIC
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


def _read_body(environ, limit=1_000_000):
    try:
        n = int(environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        n = 0
    if n > limit:
        raise ValueError("Prevelika zahteva")
    return environ["wsgi.input"].read(n) if n else b""
