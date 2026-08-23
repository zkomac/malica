"""Malica — group lunch ordering on top of Wolt.

Pure standard-library WSGI application. Entry point: ``malica.web.application``.
"""

from .web import application  # noqa: F401

__all__ = ["application"]
