"""Group API mutations (``POST /api/...``).

``handle_post`` receives the current group state and the parsed JSON body, mutates the
state in place and returns a human-readable summary line for the change log (or ``None``
when the route does not exist, or ``""`` when nothing changed).
"""
import re
import uuid
from datetime import date

from .domain import day_label, deadline_passed, find_day, is_wolt_url, money, text
from .storage import _now

def _append(state, day, summary):
    state["days"].append(day)
    return summary


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
        kind = body.get("kind") if body.get("kind") in ("order", "out", "poll") else "order"
        d = text(body.get("date")) or date.today().isoformat()
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
            raise ValueError("Neveljaven datum")
        venue = body.get("venue") if isinstance(body.get("venue"), dict) else None
        if venue and not is_wolt_url(text(venue.get("url"), 500)):
            venue["url"] = ""
        url = text(body.get("url"), 500)
        day = {
            "id": uuid.uuid4().hex[:8], "date": d, "kind": kind,
            "restaurant": text(body.get("restaurant")),
            "url": url if is_wolt_url(url) else "", "venue": venue,
            "proposedBy": text(body.get("proposedBy")), "deadline": text(body.get("deadline"), 40),
            "status": "open", "orders": [],
            "fees": {"delivery": 0, "service": 0, "tip": 0, "discount": 0},
            "feeSplit": "proportional", "payer": "", "paid": [],
        }
        if kind == "order":
            if not day["restaurant"]:
                raise ValueError("Restavracija je obvezna")
            if not is_wolt_url(url):
                raise ValueError("Neveljavna povezava")
            day["url"] = url
            day["orderer"] = text(body.get("orderer") or body.get("proposedBy"))
            return _append(state, day, "predlagal/a %s" % day_label(day))
        if kind == "out":
            if not day["restaurant"]:
                raise ValueError("Kraj je obvezen")
            day["outTime"] = text(body.get("outTime"), 20)
            day["going"], day["skip"] = [], []
            return _append(state, day, "predlagal/a: gremo ven — %s" % day["restaurant"])
        # kind == poll
        day["restaurant"] = day["restaurant"] or "Kaj danes jemo?"
        day["poll"] = {"options": [], "closed": False}
        return _append(state, day, "začel/a anketo: %s" % day["restaurant"])

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
            if body.get("kind") in ("order", "out", "poll") and body["kind"] != day.get("kind"):
                day["kind"] = body["kind"]; changes.append("način")
            if isinstance(body.get("venue"), dict):
                vv = body["venue"]
                if vv.get("url") and not is_wolt_url(text(vv.get("url"), 500)):
                    vv["url"] = ""
                day["venue"] = vv
            if "outTime" in body:
                day["outTime"] = text(body["outTime"], 20)
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

        # -- eating out: attendance -------------------------------------
        if action == "attend":
            person = text(body.get("person"), 60)
            if not person:
                raise ValueError("Ime je obvezno")
            if person not in state["people"]:
                state["people"].append(person)
            day.setdefault("going", [])
            day.setdefault("skip", [])
            day["going"] = [p for p in day["going"] if p != person]
            day["skip"] = [p for p in day["skip"] if p != person]
            if body.get("going") is True:
                day["going"].append(person)
            elif body.get("going") is False:
                day["skip"].append(person)
            return ""

        # -- poll: options and votes ------------------------------------
        if action.startswith("poll"):
            poll = day.get("poll")
            if not isinstance(poll, dict):
                raise ValueError("Ta dan ni anketa")

            if action == "poll-option":
                if poll.get("closed"):
                    raise ValueError("Anketa je zaključena")
                label = text(body.get("label"), 80)
                if not label:
                    raise ValueError("Opis opcije je obvezen")
                okind = body.get("optKind") if body.get("optKind") in ("order", "out") else "out"
                if len(poll["options"]) >= 20:
                    raise ValueError("Preveč opcij")
                poll["options"].append({
                    "id": uuid.uuid4().hex[:6], "label": label, "kind": okind,
                    "by": text(body.get("person"), 60), "votes": [],
                })
                return "dodal/a v anketo: %s" % label

            if action == "poll-option-delete":
                oid = text(body.get("optionId"), 16)
                poll["options"] = [o for o in poll["options"] if o["id"] != oid]
                return ""

            if action == "poll-vote":
                if poll.get("closed"):
                    raise ValueError("Anketa je zaključena")
                person = text(body.get("person"), 60)
                if not person:
                    raise ValueError("Ime je obvezno")
                if person not in state["people"]:
                    state["people"].append(person)
                oid = text(body.get("optionId"), 16)
                for o in poll["options"]:
                    o["votes"] = [v for v in o["votes"] if v != person]
                if oid:
                    tgt = next((o for o in poll["options"] if o["id"] == oid), None)
                    if tgt:
                        tgt["votes"].append(person)
                return ""

            if action == "poll-close":
                if not poll["options"]:
                    raise ValueError("Ni opcij za zaključek")
                winner = max(poll["options"], key=lambda o: len(o["votes"]))
                poll["closed"] = True
                poll["winnerId"] = winner["id"]
                day["kind"] = winner["kind"]
                day["restaurant"] = winner["label"]
                if winner["kind"] == "out":
                    day.setdefault("going", [])
                    day.setdefault("skip", [])
                else:
                    day.setdefault("orderer", winner.get("by", ""))
                return "zaključil/a anketo — zmagal/a: %s" % winner["label"]

            if action == "poll-reopen":
                poll["closed"] = False
                poll.pop("winnerId", None)
                day["kind"] = "poll"
                return "ponovno odprl/a anketo"

            return None

        if action in ("orders", "orders-delete") and day.get("kind", "order") != "order":
            raise ValueError("Ta dan ni naročilo")
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
