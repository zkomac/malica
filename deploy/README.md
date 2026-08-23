# Deploying Malica

Two options. **Docker** is the recommended one; the bare-metal script is kept for servers without Docker.

Both run the app on `127.0.0.1:8000` behind nginx on the host, with a Let's Encrypt certificate. Data lives in `/opt/malica/data/` (one JSON per group, a `.history/` folder with previous versions, a `.log.jsonl` change log and the cookie-signing `.secret`).

## Option A — Docker (recommended)

Tested on AlmaLinux 9; any RHEL-like VPS works (Debian/Ubuntu: install Docker the distro way, the rest is the same).

```bash
# 1. DNS: A record  malica.example.com -> server IP
# 2. On the server:
dnf -y install git
git clone https://github.com/zkomac/malica.git /opt/malica
bash /opt/malica/deploy/install-docker.sh malica.example.com you@example.com
```

The script installs Docker, builds the image, starts the container (`restart: unless-stopped`, health-checked), writes `malica.env` from `.env.example` if missing, sets up nginx + certbot + firewall, and disables the old systemd `malica` unit if one exists. Then edit `/opt/malica/malica.env` (`MALICA_ADMIN_PIN` …) and `docker compose restart`.

| Task | Command (in `/opt/malica`) |
|---|---|
| Update the app | `git pull && docker compose up -d --build` |
| Change env vars | edit `malica.env`, then `docker compose up -d` |
| Logs | `docker compose logs -f` |
| Status | `docker compose ps` |
| Back up data | `scp -r root@SERVER:/opt/malica/data ./backup/` |
| Roll back | `git checkout <commit> && docker compose up -d --build` |

Run it anywhere else (laptop, another host): `cp .env.example malica.env && docker compose up --build` → http://localhost:8000.

### Migrating from the systemd install

`install-docker.sh` handles it: it stops and disables the `malica` unit and reuses the existing `/opt/malica/data/` and `malica.env`. Turn the repo checkout into `/opt/malica` first (`git clone` into a temp dir, move `data/` and `malica.env` in, swap directories). The old `.secret` next to `app.py` moves to `data/.secret` so nobody has to re-enter the PIN:

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
