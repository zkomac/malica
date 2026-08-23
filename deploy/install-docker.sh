#!/usr/bin/env bash
# Malica on Docker (AlmaLinux 9 / any RHEL-like). Run as root:
#   bash deploy/install-docker.sh malica.example.com you@example.com
# Installs Docker, nginx + Let's Encrypt on the host, and runs the app with docker compose.
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
  sed "s/^MALICA_PIN=.*/MALICA_PIN=$(( RANDOM % 9000 + 1000 ))/" .env.example > malica.env
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

echo "==> nginx + HTTPS"
dnf -y install epel-release >/dev/null
dnf -y install nginx certbot python3-certbot-nginx firewalld policycoreutils-python-utils >/dev/null
if [ ! -f /etc/nginx/conf.d/malica.conf ]; then
cat > /etc/nginx/conf.d/malica.conf <<CONF
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 1m;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
CONF
fi
cp deploy/nginx-gzip.conf /etc/nginx/conf.d/gzip.conf 2>/dev/null || true
nginx -t
setsebool -P httpd_can_network_connect 1
systemctl enable --now nginx firewalld
firewall-cmd --permanent --add-service=http --add-service=https >/dev/null
firewall-cmd --reload >/dev/null
systemctl reload nginx
if ! grep -q "listen 443" /etc/nginx/conf.d/malica.conf; then
  certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect || \
    echo "!! certbot failed (DNS not propagated yet?). Retry later: certbot --nginx -d $DOMAIN"
fi

echo
echo "Done: https://$DOMAIN"
echo "  update:  cd $APP_DIR && git pull && docker compose up -d --build"
echo "  logs:    docker compose -f $APP_DIR/docker-compose.yml logs -f"
echo "  data:    $APP_DIR/data/"
