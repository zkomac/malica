# Deploying Malica

Two options. **Docker** is the recommended one; the bare-metal script is kept for servers without Docker.

Docker runs the whole stack — Caddy (TLS via Let's Encrypt, gzip) in front of the app — so nothing is installed on the host except Docker. Bare metal runs the app on `127.0.0.1:8000` behind nginx on the host. Data lives in `/opt/malica/data/` (one JSON per group, a `.history/` folder with previous versions, a `.log.jsonl` change log and the cookie-signing `.secret`).

## Option A — Docker (recommended)

Tested on AlmaLinux 9; any RHEL-like VPS works (Debian/Ubuntu: install Docker the distro way, the rest is the same).

```bash
# 1. DNS: A record  malica.example.com -> server IP
# 2. On the server:
dnf -y install git
git clone https://github.com/zkomac/malica.git /opt/malica
bash /opt/malica/deploy/install-docker.sh malica.example.com you@example.com
```

The script installs Docker, writes `malica.env` from `.env.example` if missing (domain, e-mail, random first PIN), opens the firewall, disables the old systemd `malica` unit if one exists, and starts both containers. Caddy requests the certificate on first start (DNS must already point at the server). Then edit `/opt/malica/malica.env` (`MALICA_ADMIN_PIN` …) and `docker compose up -d`.

| Task | Command (in `/opt/malica`) |
|---|---|
| Update the app | `git pull && docker compose up -d --build` |
| Change env vars | edit `malica.env`, then `docker compose up -d` |
| Logs | `docker compose logs -f` (`docker compose logs -f caddy` for TLS/proxy) |
| Status | `docker compose ps` |
| Back up data | `scp -r root@SERVER:/opt/malica/data ./backup/` |
| Roll back | `git checkout <commit> && docker compose up -d --build` |

Run it anywhere else (laptop, another host): `cp .env.example malica.env`, set `MALICA_DOMAIN=localhost`, `docker compose up --build` → https://localhost (self-signed certificate, accept the browser warning).

### Migrating from the systemd install

`install-docker.sh` handles it: it stops and disables the `malica` unit and reuses the existing `/opt/malica/data/` and `malica.env` (add `MALICA_DOMAIN` and `MALICA_TLS_EMAIL`). Stop the host nginx first (`systemctl disable --now nginx`) so Caddy can bind 80/443. Turn the repo checkout into `/opt/malica` first (`git clone` into a temp dir, move `data/` and `malica.env` in, swap directories). The old `.secret` next to `app.py` moves to `data/.secret` so nobody has to re-enter the PIN:

```bash
mv /opt/malica/.secret /opt/malica/data/.secret 2>/dev/null; chown 1000:1000 /opt/malica/data/.secret
```

## Option B — bare metal (gunicorn + systemd)

```bash
ssh root@SERVER "mkdir -p /opt/malica"
scp -r app.py malica static deploy/install.sh deploy/nginx-gzip.conf root@SERVER:/opt/malica/
ssh root@SERVER bash /opt/malica/install.sh malica.example.com you@example.com
```

Update: `scp -r app.py malica static root@SERVER:/opt/malica/` then `systemctl restart malica`. Logs: `journalctl -u malica -f`.
