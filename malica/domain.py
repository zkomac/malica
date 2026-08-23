"""Small domain helpers shared by the API layer: validation, money, deadlines."""
import re
from datetime import datetime

from .storage import _now

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
