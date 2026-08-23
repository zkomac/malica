# Architecture

Malica is deliberately small: one Python process, one page of JavaScript, JSON files on disk. This document explains the shape of the system and the decisions behind it, so the constraints are visible before anyone "fixes" them.

## System overview

```
 ┌──────────────┐   HTTPS    ┌──────────────┐   WSGI   ┌──────────────────┐
 │ Browser      │ ─────────▶ │ nginx        │ ───────▶ │ gunicorn (1×N)   │
 │ static/*.js  │ ◀───────── │ TLS, gzip    │ ◀─────── │ malica.web       │
 └──────┬───────┘            └──────────────┘          └────────┬─────────┘
        │ window.postMessage                                    │ JSON files
        ▼                                                       ▼
 ┌──────────────┐  wolt.com tab  ┌──────────────┐      ┌──────────────────┐
 │ Extension    │ ─────────────▶ │ Wolt web API │      │ data/<gid>.json  │
 │ (MV3)        │ ◀───────────── │ (unofficial) │      │ data/<gid>.history/
 └──────────────┘                └──────────────┘      │ data/<gid>.log.jsonl
                                        ▲              └──────────────────┘
                                        │ restaurant/menu proxy (cached)
                                        └──────────── malica.wolt
```

## Server (`malica/`)

| Module | Responsibility |
|---|---|
| `config.py` | Paths, environment settings, the process-wide `RLock`, timezone. `DATA_DIR` is a mutable module attribute so tests can redirect it. |
| `storage.py` | Groups registry (`groups.json`), per-group state, atomic writes, version history, change log. |
| `domain.py` | Pure helpers: input sanitising, money rounding, deadline logic, labels. |
| `api.py` | `handle_post()` — every `POST /api/...` mutation, expressed as "mutate state, return a log line". |
| `wolt.py` | Client for Wolt's web endpoints (discovery, menu), in-memory TTL cache with single-flight, background refresh, basket payload builder. |
| `auth.py` | Signed session cookie, admin token, constant-time comparisons, per-IP PIN lockout. |
| `admin.py` | `/api/admin/*`: groups CRUD, log, versions, restore, remove person. |
| `pages.py` | The server-rendered landing page (PIN entry + extension hint). |
| `web_util.py` | JSON responses, traversal-safe static serving, bounded body reading. |
| `web.py` | `application()` — the router. Order: public static → PIN/logout → admin → group-scoped API/static. |

### Request lifecycle

1. `web.application` parses the path and method.
2. Public paths (icons, privacy policy, `/pin`) are served without a session.
3. Everything else requires the `malica_g` cookie; `auth._group_from_cookie` verifies the HMAC and resolves the group id.
4. Reads (`/api/state`, Wolt proxy) run under the lock; writes go through `api.handle_post`, which returns a summary that `storage.save` writes to the change log together with a history snapshot.
5. The response is the full new state, so the client never needs a second round trip.

### Data model

One JSON document per group:

```json
{
  "people": ["Ana", "Marko"],
  "location": {"lat": 46.05, "lon": 14.51, "label": "Ljubljana"},
  "days": [{
    "id": "8 hex", "date": "2026-08-23", "restaurant": "…", "url": "https://wolt.com/…",
    "venue": {"id": "…", "slug": "…", "url": "…"}, "orderer": "Ana", "deadline": "11:30",
    "status": "open | ordered",
    "orders": [{"id": "…", "person": "Ana", "item": "…", "price": 12.49, "qty": 1,
                "options": "text", "itemId": "wolt id", "opts": [/* Wolt option ids for the basket */]}],
    "grandTotal": 36.47, "feeSplit": "proportional | equal", "payer": "Ana", "paid": ["Marko"]
  }]
}
```

The cost split is computed on the client (`static/js/split.js`) from `grandTotal − Σ(orders)`; the server stores inputs, not derived numbers, so the rule can change without migrating data.

## Client (`static/`)

Vanilla JavaScript, no build step. Classic scripts share one global scope and are loaded in dependency order from `index.html`:

`core.js` (helpers, state, API, extension bridge) → `split.js` → `views.js` (render) → `modals.js` → `admin.js` → `order-mode.js` → `main.js` (event delegation, polling).

The UI is rendered from the full state object (`render()` re-draws `#main`), and every mutation replaces the state with the server's response. A 5-second poll with an ETag-like JSON comparison keeps colleagues in sync without WebSockets.

`/o/<day>` ("ordering mode") is the same bundle with a different route: a phone-friendly checklist for the person placing the order.

## Browser extension (`extension/`)

Wolt has no public API, and its endpoints reject any request whose `Origin` is an extension. So the extension never calls Wolt from its service worker; it opens (or reuses) a `wolt.com` tab and asks the content script there to perform the request with the page's origin. The service worker only:

- reads the `__wrtoken` cookie and exchanges it for a short-lived access token,
- fetches the basket payload from Malica (`/api/wolt/basket`, allowed only for the day's orderer),
- relays calls to the `wolt.com` tab (`woltFetch` message),
- after payment, looks up today's order in the Wolt order history and, on the user's click, closes the day in Malica with the real total.

Nothing is persisted; every run starts from the live cookie. All outcomes (success or error) are posted to `/api/wolt/extlog` so they show up in the group's change log for debugging.

## Decisions

- **No database.** Groups are small (tens of people, one order a day). A JSON file per group with atomic rename, a bounded history folder and a log line per change gives backups, audit and undo for free. The `RLock` serialises writers inside the single gunicorn worker (`--workers 1 --threads 8`); scaling beyond one process would require moving the lock out of the process — a deliberate non-goal.
- **No framework, no build.** Everything a contributor needs is readable in a couple of files; deployment is `scp` + restart.
- **Sessions are signed, not stored.** The cookie is `gid.HMAC(gid:pin)`, keyed by a per-install `.secret`. Changing a group's PIN invalidates all its sessions without any server-side table.
- **The server stores inputs, the client derives.** Keeps the data honest and the split rules easy to evolve.
- **Wolt access is best-effort.** Discovery and menus are cached and refreshed in the background; if Wolt changes something, the app degrades to manual entry and the ordering checklist, and the split still works.

## Testing

`tests/test_app.py` drives the WSGI app directly through a tiny in-process client (cookies, JSON, forms) with `config.DATA_DIR` pointed at a temp dir. It covers sessions and lockout, the full order/finish flow, validation, deadlines, admin operations, extension logging, static serving safety and recovery from a corrupted state file. Run `python -m unittest discover -s tests -v`; CI runs the same on every push.
