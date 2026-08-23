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
        app.DATA_DIR = tempfile.mkdtemp()
        app._PIN_FAILS.clear()
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
                "proposedBy": "Ana", "orderer": "Ana", "date": app._now().strftime("%Y-%m-%d"), "deadline": ""}
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
        gid = app.load_groups()["groups"][0]["id"]
        log = app.read_log(gid, 1)
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
        gid = app.load_groups()["groups"][0]["id"]
        with open(os.path.join(app.DATA_DIR, gid + ".json"), "w") as f:
            f.write("{corrupt")
        code, j = self.c.get("/api/state")
        self.assertEqual(code, 200)
        self.assertTrue(isinstance(j["days"], list))


if __name__ == "__main__":
    unittest.main()
