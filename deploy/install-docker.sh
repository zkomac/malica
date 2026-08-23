#!/usr/bin/env bash
# Malica on Docker (AlmaLinux 9 / any RHEL-like). Run as root:
#   bash deploy/install-docker.sh malica.example.com you@example.com
# Installs Docker and runs the whole stack (Caddy with automatic Let's Encrypt + the app) with docker compose.
# Safe to re-run. Expects the repository checked out in /opt/malica (git clone or rsync).
set -euo pipefail

DOMAIN="${1:?Usage: bash install-docker.sh <domain> <letsencrypt-email>}"
EMAIL="${2:?Usage: bash install-docker.sh <domain> <letsencrypt-email>}"
APP_DIR=/opt/malica
cd "$APP_DIR"
test -f Dockerfile || { echo "!! $APP_DIR/Dockerfile missing — clone the repo into $APP_DIR first."; exit 1; }

echo "==> Docker"
if ! command -v docker >/dev/null; then
  dnf -y install dnf-plugins-core
  dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
  dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
systemctl enable --now docker

echo "==> Environment file"
if [ ! -f malica.env ]; then
  sed -e "s/^MALICA_PIN=.*/MALICA_PIN=$(( RANDOM % 9000 + 1000 ))/"       -e "s/^MALICA_DOMAIN=.*/MALICA_DOMAIN=$DOMAIN/"       -e "s/^MALICA_TLS_EMAIL=.*/MALICA_TLS_EMAIL=$EMAIL/" .env.example > malica.env
  chmod 600 malica.env
  echo "   created malica.env — edit MALICA_ADMIN_PIN etc., then: docker compose restart"
fi
mkdir -p data
chown -R 1000:1000 data          # uid of the 'malica' user inside the image

echo "==> Retire the old systemd service (if any)"
if systemctl list-unit-files malica.service >/dev/null 2>&1 && systemctl is-enabled malica >/dev/null 2>&1; then
  systemctl disable --now malica
fi

echo "==> Build and start"
docker compose up -d --build
docker compose ps

echo "==> Firewall (Caddy in the container serves 80/443 and handles TLS)"
dnf -y install firewalld >/dev/null
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=http --add-service=https >/dev/null
firewall-cmd --reload >/dev/null
if systemctl is-active nginx >/dev/null 2>&1; then
  echo "!! nginx is running on the host and would block ports 80/443: systemctl disable --now nginx, then docker compose up -d"
fi

echo
echo "Done: https://$DOMAIN"
echo "  update:  cd $APP_DIR && git pull && docker compose up -d --build"
echo "  logs:    docker compose -f $APP_DIR/docker-compose.yml logs -f"
echo "  data:    $APP_DIR/data/"
