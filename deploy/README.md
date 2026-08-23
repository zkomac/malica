# Deploying Malica

Tested on **AlmaLinux 9** (any RHEL-like VPS). Runs gunicorn behind nginx with a Let's Encrypt certificate, as a systemd service.

## 1. DNS
Create an `A` record for your domain (e.g. `malica.example.com`) pointing to the server IP.

## 2. Copy the app
```bash
ssh root@SERVER "mkdir -p /opt/malica"
scp -r app.py static deploy/install.sh root@SERVER:/opt/malica/
```

## 3. Install
```bash
ssh root@SERVER
bash /opt/malica/install.sh malica.example.com you@example.com
```
The script installs Python, nginx and certbot, creates a `malica` system user and venv, writes the systemd unit, enables gzip, opens the firewall, obtains the certificate and starts the service. A random first-group PIN is written to `/opt/malica/malica.env` — edit that file to set `MALICA_ADMIN_PIN` and the other variables from `.env.example`, then `systemctl restart malica`.

## Day-to-day
| Task | Command |
|---|---|
| Update the app | `scp -r app.py malica static root@SERVER:/opt/malica/` then `systemctl restart malica` |
| Logs | `journalctl -u malica -f` |
| Back up data | `scp -r root@SERVER:/opt/malica/data ./backup/` |
| Status | `systemctl status malica nginx` |

Data lives in `/opt/malica/data/` (one JSON per group, a `.history/` folder with previous versions and a `.log.jsonl` change log).
