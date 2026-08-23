# Malica — group lunch ordering on top of Wolt

[![CI](https://github.com/zkomac/malica/actions/workflows/ci.yml/badge.svg)](https://github.com/zkomac/malica/actions/workflows/ci.yml)

**Malica** ("snack"/"lunch break" in Slovenian) turns the daily *"what are we ordering, who's ordering, how much do I owe you?"* chaos into a two-minute routine:

1. Someone proposes a restaurant (searched live on Wolt).
2. Everyone picks their own dish — with options and extras — from their phone or laptop.
3. One person places the single order on Wolt. Malica splits delivery and fees fairly and shows who pays whom.

Live instance (Slovenian UI): **https://malica.stavio.net**

> Malica is an independent project and is not affiliated with or endorsed by Wolt Enterprises Oy.

## Highlights

- **Zero dependencies.** The server is one Python file on the standard library (WSGI); the UI is one vanilla-JS HTML file. No build step, no database — data is JSON on disk with automatic versioning.
- **Groups with PINs.** Each team gets its own PIN and isolated data. An admin panel manages groups, shows a change log and can restore any previous version.
- **Live Wolt menus.** Restaurant search with filters and menu preview; dishes are picked with real options and prices, so the summary matches the Wolt basket.
- **Phone-friendly "ordering mode"** (`/o/<day>`): a clean checklist with a deep link to every dish on Wolt, reachable via QR code from the desktop summary.
- **Fair split.** Enter what you actually paid on Wolt; the difference to the food total (delivery, service fee, tip, discounts) is split proportionally or evenly. Settle-up view with "paid" checkmarks.
- **Browser extension (Chrome / Edge)** — `extension/`, published on the [Chrome Web Store](https://chromewebstore.google.com/detail/olnafjjoaojbmnogdconffbmmfhchcna): when you are today's orderer, one click moves the whole team's order, with options and quantities, into *your* Wolt basket. After you pay, it can read the final amount from your Wolt order history and close the day in Malica. Nothing is stored; your Wolt session never leaves your browser.
- **Hardened basics.** HMAC-signed cookies, constant-time PIN checks with lockout, path-traversal-safe static serving, atomic writes, recovery from a corrupted data file, regression tests run in CI.

## Project layout

```
app.py                   WSGI entry point (gunicorn app:application)
malica/                  Server package — see ARCHITECTURE.md
  web.py                 routing            api.py      group mutations
  storage.py             JSON persistence   wolt.py     Wolt client + cache
  auth.py                sessions, PIN      admin.py    admin API
server.py                Local dev server:  python server.py [port]
static/index.html        UI shell; loads app.css and static/js/*.js (vanilla JS, Slovenian)
static/js/               core, split, views, modals, admin, order-mode, main
static/qr.js             Dependency-free QR code generator
static/privacy.html      Privacy policy (required by the Chrome Web Store)
extension/               Chrome/Edge extension "Malica ↔ Wolt" (Manifest V3)
Dockerfile, docker-compose.yml, Caddyfile   Production stack: app image (python:3.12-slim + gunicorn) + Caddy (TLS)
deploy/                  install-docker.sh (Docker stack on a fresh VPS); install.sh (bare metal nginx + systemd)
tests/test_app.py        Server tests (python -m unittest discover -s tests)
tools/pack_extension.py  Builds the Web Store zip from extension/
```

Design notes and the reasoning behind the constraints are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Run locally

```bash
python server.py          # http://localhost:8000  (Python 3.9+, nothing to install)
```

`server.py` sets `MALICA_ADMIN_PIN=1234` for development; the first group is created with PIN `0000`.

## Configuration (environment variables)

| Variable | Purpose |
|---|---|
| `MALICA_PIN` | PIN of the first group (created on first start). |
| `MALICA_ADMIN_PIN` | Admin code for the admin panel (`🛠 Admin` in the user menu). |
| `MALICA_EXT_URL` | Chrome Web Store URL of the extension; when set, the landing page shows an install hint. |
| `MALICA_DEFAULT_LOCATION` | `lat,lon,Label` used for new groups (can be changed in the app). |

A `.secret` file (HMAC key for cookies) is generated automatically next to `app.py` (or at `MALICA_SECRET_FILE`; the Docker image puts it in `data/`).

## Deploy

Docker: `cp .env.example malica.env`, set the domain, `docker compose up -d --build` — Caddy obtains the Let's Encrypt certificate and proxies to the app; nothing else to install. `deploy/install-docker.sh` does it on a fresh AlmaLinux 9 VPS (Docker + firewall). A bare-metal `deploy/install.sh` (gunicorn + systemd) is kept as well. See [deploy/README.md](deploy/README.md).

## Browser extension

Install from the **[Chrome Web Store](https://chromewebstore.google.com/detail/olnafjjoaojbmnogdconffbmmfhchcna)** (Edge users: enable "Allow extensions from other stores" first). Wolt has no public API; the extension talks to the same endpoints Wolt's own web app uses, from a `wolt.com` tab in your browser, using your existing login. It requests a single permission (`cookies` for `wolt.com`) plus host access to `wolt.com` and the Malica instance. Build the store package with:

```bash
python tools/pack_extension.py
```

The extension hard-codes the Malica origin (`https://malica.stavio.net`) in `extension/background.js` and `extension/manifest.json` — change both if you self-host.

## Tests

```bash
python -m unittest discover -s tests -v
```

## About

Malica was built by [Žiga Komac](https://github.com/zkomac) — a strategy executive with an engineering background who, after watching his coworkers collect lunch orders by hand every single day, decided it was faster to build the tool than to keep doing it. It started as a small tool for one team and is shared here in case it saves yours a few minutes a day.

## License

MIT — see [LICENSE](LICENSE).
