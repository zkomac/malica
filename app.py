"""WSGI entry point kept for deployment compatibility (``gunicorn app:application``).

The application lives in the ``malica`` package; see ``malica/web.py`` for routing.
"""
from malica import application

__all__ = ["application"]
