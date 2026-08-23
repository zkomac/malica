#!/usr/bin/env bash
# Namestitev aplikacije "Malica" na AlmaLinux 9 (Namecheap VPS).
# Zagon kot root:   bash install.sh malica.stavio.net tvoj@email.si
set -euo pipefail

DOMAIN="${1:?Uporaba: bash install.sh <domena> <email-za-LetsEncrypt>}"
EMAIL="${2:?Uporaba: bash install.sh <domena> <email-za-LetsEncrypt>}"
APP_DIR=/opt/malica
APP_USER=malica

echo "==> Paketi"
dnf -y install epel-release
dnf -y install python3 python3-pip nginx certbot python3-certbot-nginx firewalld policycoreutils-python-utils

echo "==> Uporabnik in mapa"
id -u $APP_USER &>/dev/null || useradd -r -s /sbin/nologin -d $APP_DIR $APP_USER
mkdir -p $APP_DIR
# pričakuje, da so app.py in static/ že skopirani v $APP_DIR (glej README)
test -f $APP_DIR/app.py || { echo "!! Manjka $APP_DIR/app.py — najprej skopiraj datoteke."; exit 1; }
python3 -m venv $APP_DIR/venv
$APP_DIR/venv/bin/pip install --quiet --upgrade pip gunicorn
chown -R $APP_USER:$APP_USER $APP_DIR

echo "==> systemd storitev"
if [ ! -f $APP_DIR/malica.env ]; then
  PIN_DEFAULT=$(( RANDOM % 9000 + 1000 ))
  echo "MALICA_PIN=$PIN_DEFAULT" > $APP_DIR/malica.env
  chmod 600 $APP_DIR/malica.env
fi
cat > /etc/systemd/system/malica.service <<EOF
[Unit]
Description=Malica - skupinsko narocanje (gunicorn)
After=network.target

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=-$APP_DIR/malica.env
ExecStart=$APP_DIR/venv/bin/gunicorn --workers 1 --threads 8 --bind 127.0.0.1:8000 app:application
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now malica

echo "==> nginx"
cat > /etc/nginx/conf.d/malica.conf <<EOF
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
EOF
cp "$(dirname "$0")/nginx-gzip.conf" /etc/nginx/conf.d/gzip.conf 2>/dev/null || true
nginx -t
setsebool -P httpd_can_network_connect 1      # SELinux: nginx sme na localhost:8000
systemctl enable --now nginx
systemctl reload nginx

echo "==> Požarni zid"
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=http --add-service=https >/dev/null
firewall-cmd --reload >/dev/null

echo "==> HTTPS (Let's Encrypt) — DNS za $DOMAIN mora že kazati na ta strežnik"
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect || \
  echo "!! certbot ni uspel (verjetno DNS še ni osvežen). Ponovi kasneje: certbot --nginx -d $DOMAIN"

echo
echo "Končano. Aplikacija: https://$DOMAIN"
echo "  status:  systemctl status malica"
echo "  logi:    journalctl -u malica -f"
echo "  backup:  $APP_DIR/data/"
echo "  PIN za vstop (spremeni v $APP_DIR/malica.env, nato systemctl restart malica):"
cat $APP_DIR/malica.env
