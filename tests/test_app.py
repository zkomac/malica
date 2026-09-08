"""Server regression tests for Malica (pure stdlib, no network).

Run:  python -m unittest discover -s tests -v
"""
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["MALICA_PIN"] = "0000"
os.environ["MALICA_ADMIN_PIN"] = "1234"
os.environ.pop("MALICA_EXT_URL", None)

import app  # noqa: E402
from malica import auth, config, storage  # noqa: E402


class Client:
    """Minimal WSGI client that keeps cookies between requests."""

    def __init__(self):
        self.cookies = {}

    def request(self, method, path, body=None, headers=None, form=None, raw=None):
        if form is not None:
            data = urllib.parse.urlencode(form).encode()
            ctype = "application/x-www-form-urlencoded"
        elif raw is not None:
            data, ctype = raw, "application/json"
        elif body is not None:
            data, ctype = json.dumps(body).encode(), "application/json"
        else:
            data, ctype = b"", ""
        path, _, qs = path.partition("?")
        env = {
            "REQUEST_METHOD": method, "PATH_INFO": path, "QUERY_STRING": qs,
            "wsgi.input": io.BytesIO(data), "CONTENT_LENGTH": str(len(data)),
            "CONTENT_TYPE": ctype, "REMOTE_ADDR": "127.0.0.1",
            "HTTP_COOKIE": "; ".join("%s=%s" % kv for kv in self.cookies.items()),
        }
        for k, v in (headers or {}).items():
            env["HTTP_" + k.upper().replace("-", "_")] = v
        out = {}

        def start_response(status, hdrs):
            out["status"], out["headers"] = status, hdrs

        payload = b"".join(app.application(env, start_response))
        for k, v in out["headers"]:
            if k == "Set-Cookie":
                name, _, rest = v.partition("=")
                val = rest.split(";")[0]
                if "Max-Age=0" in v:
                    self.cookies.pop(name, None)
                else:
                    self.cookies[name] = val
        code = int(out["status"].split()[0])
        try:
            return code, json.loads(payload.decode("utf-8"))
        except ValueError:
            return code, payload.decode("utf-8", "replace")

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, body=None, **kw):
        return self.request("POST", path, body, **kw)


class MalicaTests(unittest.TestCase):
    def setUp(self):
        config.DATA_DIR = tempfile.mkdtemp()
        auth._PIN_FAILS.clear()
        self.c = Client()

    # -- auth -------------------------------------------------------------
    def test_landing_without_pin(self):
        code, html = self.c.get("/")
        self.assertEqual(code, 200)
        self.assertIn("PIN", html)
        self.assertNotIn("id=\"main\"", html)

    def test_api_requires_group_cookie(self):
        code, j = self.c.get("/api/state")
        self.assertEqual(code, 401)

    def test_wrong_pin_then_right_pin(self):
        code, html = self.c.post("/pin", form={"pin": "9999"})
        self.assertNotIn("malica_g", self.c.cookies)
        code, _ = self.c.post("/pin", form={"pin": "0000"})
        self.assertIn("malica_g", self.c.cookies)
        code, j = self.c.get("/api/state")
        self.assertEqual(code, 200)
        self.assertEqual(j["people"], [])

    def test_pin_bruteforce_lockout(self):
        for _ in range(6):
            self.c.post("/pin", form={"pin": "1111"})
        code, html = self.c.post("/pin", form={"pin": "0000"})
        self.assertNotIn("malica_g", self.c.cookies)

    def test_tampered_cookie_rejected(self):
        self.c.post("/pin", form={"pin": "0000"})
        self.c.cookies["malica_g"] = self.c.cookies["malica_g"][:-3] + "abc"
        code, _ = self.c.get("/api/state")
        self.assertEqual(code, 401)

    def test_non_ascii_cookie_does_not_crash(self):
        self.c.cookies["malica_g"] = "čšž.ÿ"
        code, _ = self.c.get("/api/state")
        self.assertEqual(code, 401)

    # -- day / order flow --------------------------------------------------
    def _login(self):
        self.c.post("/pin", form={"pin": "0000"})

    def _day(self, **kw):
        body = {"restaurant": "Pinsarna", "url": "https://wolt.com/sl/svn/ljubljana/restaurant/pinsarna",
                "proposedBy": "Ana", "orderer": "Ana", "date": storage._now().strftime("%Y-%m-%d"), "deadline": ""}
        body.update(kw)
        code, j = self.c.post("/api/days", body)
        self.assertEqual(code, 200, j)
        return j["days"][-1]

    def test_full_order_flow(self):
        self._login()
        day = self._day()
        code, j = self.c.post("/api/days/%s/orders" % day["id"], {"person": "Ana", "item": "Diavola", "price": 12.49, "qty": 1})
        self.assertEqual(code, 200)
        code, j = self.c.post("/api/days/%s/orders" % day["id"], {"person": "Marko", "item": "Margherita", "price": 9.99, "qty": 2, "options": "extra sir"})
        self.assertEqual(len(j["days"][0]["orders"]), 2)
        self.assertEqual(sorted(j["people"]), ["Ana", "Marko"])
        # finish with total incl. delivery
        code, j = self.c.post("/api/days/%s" % day["id"], {"grandTotal": 36.47, "payer": "Ana", "feeSplit": "proportional", "status": "ordered"})
        self.assertEqual(j["days"][0]["status"], "ordered")
        self.assertAlmostEqual(j["days"][0]["grandTotal"], 36.47)
        # adding after ordered is refused
        code, j = self.c.post("/api/days/%s/orders" % day["id"], {"person": "Nina", "item": "Cola", "price": 2.5})
        self.assertEqual(code, 400)

    def test_invalid_inputs(self):
        self._login()
        code, j = self.c.post("/api/days", {"restaurant": "", "url": ""})
        self.assertEqual(code, 400)
        code, j = self.c.post("/api/days", {"restaurant": "X", "url": "javascript:alert(1)"})
        self.assertEqual(code, 400)
        code, j = self.c.post("/api/days/nope/orders", {"person": "A", "item": "B"})
        self.assertIn(code, (400, 404))
        code, j = self.c.request("POST", "/api/people", raw=b"{not json")
        self.assertEqual(code, 400)

    def test_deadline_blocks_orders(self):
        self._login()
        day = self._day(deadline="00:01")
        code, j = self.c.post("/api/days/%s/orders" % day["id"], {"person": "Ana", "item": "X", "price": 1})
        self.assertEqual(code, 400)
        self.assertIn("Rok", j["error"])

    def test_delete_day_and_person(self):
        self._login()
        day = self._day()
        self.c.post("/api/people", {"name": "Luka"})
        code, j = self.c.post("/api/people/delete", {"name": "Luka"})
        self.assertNotIn("Luka", j["people"])
        code, j = self.c.post("/api/days/%s/delete" % day["id"], {})
        self.assertEqual(j["days"], [])

    def test_order_mode_page(self):
        self._login()
        day = self._day()
        code, html = self.c.get("/o/%s" % day["id"])
        self.assertEqual(code, 200)
        self.assertIn("id=\"main\"", html)

    # -- eating out --------------------------------------------------------
    def test_out_day_attendance_and_split(self):
        self._login()
        code, j = self.c.post("/api/days", {"kind": "out", "restaurant": "Foculus", "outTime": "12:30", "proposedBy": "Ana"})
        self.assertEqual(code, 200, j)
        day = j["days"][-1]
        self.assertEqual(day["kind"], "out")
        self.assertEqual(day["going"], [])
        code, j = self.c.post("/api/days/%s/attend" % day["id"], {"person": "Ana", "going": True})
        code, j = self.c.post("/api/days/%s/attend" % day["id"], {"person": "Marko", "going": True})
        code, j = self.c.post("/api/days/%s/attend" % day["id"], {"person": "Nina", "going": False})
        d = j["days"][0]
        self.assertEqual(sorted(d["going"]), ["Ana", "Marko"])
        self.assertEqual(d["skip"], ["Nina"])
        # toggling switches sides, never duplicates
        code, j = self.c.post("/api/days/%s/attend" % day["id"], {"person": "Nina", "going": True})
        d = j["days"][0]
        self.assertEqual(sorted(d["going"]), ["Ana", "Marko", "Nina"])
        self.assertEqual(d["skip"], [])
        # optional shared bill reuses the split fields
        code, j = self.c.post("/api/days/%s" % day["id"], {"grandTotal": 45.0, "payer": "Ana"})
        self.assertAlmostEqual(j["days"][0]["grandTotal"], 45.0)
        # out day rejects order endpoints
        code, j = self.c.post("/api/days/%s/orders" % day["id"], {"person": "Ana", "item": "X", "price": 1})
        self.assertEqual(code, 400)

    def test_out_requires_place(self):
        self._login()
        code, j = self.c.post("/api/days", {"kind": "out", "restaurant": ""})
        self.assertEqual(code, 400)

    def test_max_three_proposals_per_day(self):
        self._login()
        for i in range(3):
            self._day(restaurant="R%d" % i)
        code, j = self.c.post("/api/days", {"kind": "out", "restaurant": "Cetrti", "date": storage._now().strftime("%Y-%m-%d")})
        self.assertEqual(code, 400)
        self.assertIn("3 predlogi", j["error"])

    # -- competing proposals ----------------------------------------------
    def test_day_vote_single_per_date(self):
        self._login()
        d1 = self._day(restaurant="Pinsarna")
        d2 = self._day(restaurant="Skleda")
        code, j = self.c.post("/api/days/%s/vote" % d1["id"], {"person": "Ana"})
        self.assertEqual([x["votes"] for x in j["days"]], [["Ana"], []])
        # voting for the other proposal moves the vote
        code, j = self.c.post("/api/days/%s/vote" % d2["id"], {"person": "Ana"})
        self.assertEqual([sorted(x.get("votes", [])) for x in j["days"]], [[], ["Ana"]])
        # voting again on the same one retracts it
        code, j = self.c.post("/api/days/%s/vote" % d2["id"], {"person": "Ana"})
        self.assertEqual([x.get("votes", []) for x in j["days"]], [[], []])

    # -- poll --------------------------------------------------------------
    def test_poll_flow(self):
        self._login()
        code, j = self.c.post("/api/days", {"kind": "poll", "restaurant": "Kaj danes?", "proposedBy": "Ana"})
        self.assertEqual(code, 200, j)
        day = j["days"][-1]
        self.assertEqual(day["kind"], "poll")
        self.assertFalse(day["poll"]["closed"])
        code, j = self.c.post("/api/days/%s/poll-option" % day["id"], {"label": "Naročamo Wolt", "optKind": "order", "person": "Ana"})
        code, j = self.c.post("/api/days/%s/poll-option" % day["id"], {"label": "Foculus", "optKind": "out", "person": "Marko"})
        opts = j["days"][0]["poll"]["options"]
        self.assertEqual(len(opts), 2)
        wolt_id, out_id = opts[0]["id"], opts[1]["id"]
        # votes: 2 for out, 1 for order
        self.c.post("/api/days/%s/poll-vote" % day["id"], {"optionId": out_id, "person": "Marko"})
        self.c.post("/api/days/%s/poll-vote" % day["id"], {"optionId": out_id, "person": "Nina"})
        code, j = self.c.post("/api/days/%s/poll-vote" % day["id"], {"optionId": wolt_id, "person": "Ana"})
        opts = {o["id"]: o["votes"] for o in j["days"][0]["poll"]["options"]}
        self.assertEqual(sorted(opts[out_id]), ["Marko", "Nina"])
        # re-vote moves the vote, never double-counts
        code, j = self.c.post("/api/days/%s/poll-vote" % day["id"], {"optionId": out_id, "person": "Ana"})
        opts = {o["id"]: o["votes"] for o in j["days"][0]["poll"]["options"]}
        self.assertEqual(opts[wolt_id], [])
        self.assertEqual(sorted(opts[out_id]), ["Ana", "Marko", "Nina"])
        # close -> winner (out: Foculus) becomes the plan
        code, j = self.c.post("/api/days/%s/poll-close" % day["id"], {})
        d = j["days"][0]
        self.assertTrue(d["poll"]["closed"])
        self.assertEqual(d["kind"], "out")
        self.assertEqual(d["restaurant"], "Foculus")
        # cannot vote on a closed poll
        code, j = self.c.post("/api/days/%s/poll-vote" % day["id"], {"optionId": out_id, "person": "Ana"})
        self.assertEqual(code, 400)

    def test_poll_winner_venue_lands_on_day(self):
        self._login()
        code, j = self.c.post("/api/days", {"kind": "poll"})
        day = j["days"][-1]
        venue = {"id": "v1", "slug": "pinsarna", "name": "Pinsarna", "url": "https://wolt.com/sl/svn/ljubljana/restaurant/pinsarna", "rating": 9.4}
        code, j = self.c.post("/api/days/%s/poll-option" % day["id"],
                              {"label": "Pinsarna", "optKind": "order", "person": "Ana", "url": venue["url"], "venue": venue})
        oid = j["days"][0]["poll"]["options"][0]["id"]
        self.c.post("/api/days/%s/poll-vote" % day["id"], {"optionId": oid, "person": "Ana"})
        code, j = self.c.post("/api/days/%s/poll-close" % day["id"], {})
        d = j["days"][0]
        self.assertEqual(d["kind"], "order")
        self.assertEqual(d["venue"]["slug"], "pinsarna")
        self.assertEqual(d["url"], venue["url"])
        # a non-wolt venue url is stripped, not stored
        code, j = self.c.post("/api/days", {"kind": "poll"})
        day2 = j["days"][-1]
        code, j = self.c.post("/api/days/%s/poll-option" % day2["id"],
                              {"label": "X", "optKind": "order", "person": "Ana", "url": "https://evil.example/x", "venue": {"url": "https://evil.example/x"}})
        o = j["days"][-1]["poll"]["options"][0]
        self.assertEqual(o["url"], "")
        self.assertEqual(o["venue"]["url"], "")

    def test_poll_close_needs_options(self):
        self._login()
        code, j = self.c.post("/api/days", {"kind": "poll"})
        day = j["days"][-1]
        code, j = self.c.post("/api/days/%s/poll-close" % day["id"], {})
        self.assertEqual(code, 400)

    # -- wolt helpers ------------------------------------------------------
    def test_basket_only_for_orderer(self):
        self._login()
        day = self._day()
        self.c.post("/api/days/%s/orders" % day["id"], {"person": "Ana", "item": "Diavola", "price": 12.49, "itemId": "0" * 24})
        code, j = self.c.get("/api/wolt/basket?dayId=%s&who=Marko" % day["id"])
        self.assertEqual(code, 403)
        code, j = self.c.get("/api/wolt/mydays?who=Ana")
        self.assertEqual(code, 200)
        self.assertEqual(j["days"][0]["id"], day["id"])

    def test_extlog_writes_group_log(self):
        self._login()
        code, j = self.c.post("/api/wolt/extlog", {"who": "Ana", "ok": False, "text": "HTTP 403"})
        self.assertEqual(code, 200)
        gid = storage.load_groups()["groups"][0]["id"]
        log = storage.read_log(gid, 1)
        self.assertIn("NAPAKA", log[0]["text"])
        self.assertEqual(log[0]["who"], "Ana")

    # -- admin -------------------------------------------------------------
    def test_admin(self):
        self._login()
        code, j = self.c.post("/api/admin/login", {"pin": "wrong"})
        self.assertEqual(code, 401)
        code, j = self.c.post("/api/admin/login", {"pin": "1234"})
        tok = j["token"]
        code, j = self.c.get("/api/admin/groups")
        self.assertEqual(code, 403)
        H = {"X-Admin": tok}
        code, j = self.c.get("/api/admin/groups", headers=H)
        self.assertEqual(code, 200)
        gid = j["groups"][0]["id"]
        code, j = self.c.post("/api/admin/groups", {"name": "Marketing", "pin": "0000"}, headers=H)
        self.assertEqual(code, 400)  # duplicate PIN
        code, j = self.c.post("/api/admin/groups", {"name": "Marketing", "pin": "2222"}, headers=H)
        self.assertEqual(code, 200)
        self.c.post("/api/people", {"name": "Ana"})
        code, j = self.c.post("/api/admin/group/%s/removeperson" % gid, {"name": "Ana"}, headers=H)
        self.assertEqual(j["people"], [])
        code, j = self.c.get("/api/admin/group/%s/versions" % gid, headers=H)
        self.assertTrue(j["versions"])
        code, j = self.c.post("/api/admin/group/%s/restore" % gid, {"version": "../../etc"}, headers=H)
        self.assertEqual(code, 404)

    # -- self-service groups ----------------------------------------------
    def test_newgroup_creates_and_logs_in(self):
        code, _ = self.c.request("POST", "/newgroup", form={"name": "Ekipa X", "pin": "4321"})
        self.assertIn("malica_g", self.c.cookies)
        code, j = self.c.get("/api/state")
        self.assertEqual(code, 200)
        gid = storage.group_by_pin("4321")["id"]
        self.assertEqual(gid, "ekipa-x")

    def test_newgroup_validation_and_duplicate_pin(self):
        code, html = self.c.request("POST", "/newgroup", form={"name": "", "pin": "12"})
        self.assertNotIn("malica_g", self.c.cookies)
        self.assertIn("4–8", html)
        code, html = self.c.request("POST", "/newgroup", form={"name": "Dvojnik", "pin": "0000"})
        self.assertIn("že uporablja", html)

    def test_newgroup_rate_limited_per_ip(self):
        from malica import web
        web._NEWGROUP_IP.clear()
        for i in range(3):
            c = Client()
            c.request("POST", "/newgroup", form={"name": "G%d" % i, "pin": str(7000 + i)})
        c = Client()
        code, html = c.request("POST", "/newgroup", form={"name": "G9", "pin": "7999"})
        self.assertNotIn("malica_g", c.cookies)
        self.assertIn("poskusi čez", html)
        web._NEWGROUP_IP.clear()

    def test_admin_delete_group_soft(self):
        self._login()
        code, j = self.c.post("/api/admin/login", {"pin": "1234"})
        H = {"X-Admin": j["token"]}
        code, j = self.c.post("/api/admin/groups", {"name": "Zacasna", "pin": "5555"}, headers=H)
        gid = j["id"]
        code, j = self.c.post("/api/admin/group/%s/delete" % gid, {}, headers=H)
        self.assertEqual(code, 200)
        self.assertIsNone(storage.find_group(gid))
        trash = os.path.join(config.DATA_DIR, "trash")
        self.assertTrue(any(d.startswith(gid + "-") for d in os.listdir(trash)))
        # brez admin žetona brisanje ni mogoče
        code, j = self.c.post("/api/admin/group/proplus/delete", {})
        self.assertEqual(code, 403)

    # -- static / safety ---------------------------------------------------
    def test_static_and_traversal(self):
        for p in ("/privacy.html", "/icon.svg", "/manifest.json", "/wolt-logo.png"):
            code, _ = self.c.get(p)
            self.assertEqual(code, 200, p)
        # unknown / traversal paths never leak files (they fall back to the landing page)
        for p in ("/../app.py", "/static/../../etc/passwd", "/app.py", "/..%2Fapp.py", "/.secret"):
            code, body = self.c.get(p)
            self.assertNotIn("def application", str(body), p)
            self.assertNotIn("MALICA_PIN", str(body), p)

    def test_corrupt_data_file_recovers_from_history(self):
        self._login()
        self._day()
        gid = storage.load_groups()["groups"][0]["id"]
        with open(os.path.join(config.DATA_DIR, gid + ".json"), "w") as f:
            f.write("{corrupt")
        code, j = self.c.get("/api/state")
        self.assertEqual(code, 200)
        self.assertTrue(isinstance(j["days"], list))


if __name__ == "__main__":
    unittest.main()
