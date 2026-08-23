#!/usr/bin/env python3
"""Lokalni zagon:  python server.py [port]   (privzeto 8000)"""
import os
import sys
os.environ.setdefault("MALICA_ADMIN_PIN", "1234")  # lokalni razvoj; na strežniku nastavi v malica.env
from socketserver import ThreadingMixIn
from wsgiref.simple_server import WSGIServer, make_server

from app import application


class ThreadingWSGIServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    srv = make_server("0.0.0.0", port, application, server_class=ThreadingWSGIServer)
    print(f"Wolt skupinsko naročanje teče na http://localhost:{port}  (Ctrl+C za izhod)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
