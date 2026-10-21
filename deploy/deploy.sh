#!/usr/bin/env bash
# Автоустановка Mini App на Ubuntu 22.04/24.04.
# Запуск из каталога app/ на сервере:
#   sudo bash deploy.sh ДОМЕН BOT_TOKEN [WEBAPP_PATH]
set -euo pipefail

DOMAIN="${1:?usage: deploy.sh DOMAIN BOT_TOKEN}"
TOKEN="${2:?usage: deploy.sh DOMAIN BOT_TOKEN}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Пакеты"
apt-get update -qq
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || true
apt-get install -y nodejs nginx certbot python3-certbot-nginx curl >/dev/null

echo "==> Зависимости"
cd "$APP_DIR"
npm ci --omit=dev

echo "==> .env"
cat > .env <<EOF
BOT_TOKEN=$TOKEN
WEBAPP_URL=https://$DOMAIN
PORT=3000
EOF

echo "==> pm2"
npm i -g pm2 >/dev/null
pm2 delete trainer 2>/dev/null || true
pm2 start server/index.js --name trainer
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "==> nginx"
sed "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" "$APP_DIR/../deploy/nginx.conf" > /etc/nginx/sites-available/trainer
ln -sf /etc/nginx/sites-available/trainer /etc/nginx/sites-enabled/trainer
nginx -t && systemctl reload nginx

echo "==> HTTPS (certbot)"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" || \
  echo "certbot не сработал — проверь, что домен указывает на этот IP, и повтори: certbot --nginx -d $DOMAIN"

echo
echo "==> Готово. Проверка:"
curl -sk "https://$DOMAIN/api/levels" | head -c 120 || true
echo
echo "Mini App: https://$DOMAIN/"
