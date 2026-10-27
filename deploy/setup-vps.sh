#!/usr/bin/env bash
# Безопасная настройка VPS (Ubuntu / Debian) для RustHoldem рядом с нодой Xray
# Не занимает порты 80 и 443 (не конфликтует с Xray) и гарантированно поднимает HTTPS на порту 8443.
# Запуск: sudo bash setup-vps.sh [ваш-домен]

set -euo pipefail

DOMAIN="${1:-poker.vikhr.online}"
BINARY_PATH="/usr/local/bin/rust-poker-room"
SERVICE_NAME="rust-poker"
VPS_IP=$(curl -s4 ifconfig.me || hostname -I | awk '{print $1}')

echo "=== 1. Создание/обновление systemd-сервиса ${SERVICE_NAME}.service (порт 3000) ==="
cat >/etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=RustHoldem Lightweight Poker & WebRTC Signaling Server
After=network.target

[Service]
Type=simple
User=root
Environment=PORT=3000
Environment=RUST_LOG=rust_poker_room=info
ExecStart=${BINARY_PATH}
Restart=always
RestartSec=2
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}

if ! command -v caddy &>/dev/null; then
    echo "=== 2. Установка Caddy ==="
    apt-get update
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl openssl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
fi

echo "=== 3. Генерация SSL-сертификата для ${DOMAIN} и ${VPS_IP} (порт 8443) ==="
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/caddy/poker.key \
    -out /etc/caddy/poker.crt \
    -subj "/CN=${DOMAIN}" \
    -addext "subjectAltName=DNS:${DOMAIN},IP:${VPS_IP}"

chown caddy:caddy /etc/caddy/poker.key /etc/caddy/poker.crt || true
chmod 600 /etc/caddy/poker.key
chmod 644 /etc/caddy/poker.crt

cat >/etc/caddy/Caddyfile <<EOF
{
    auto_https off
}

https://${DOMAIN}:8443, https://${VPS_IP}:8443 {
    tls /etc/caddy/poker.crt /etc/caddy/poker.key
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
EOF

systemctl restart caddy

if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
    ufw allow 3000/tcp
    ufw allow 8443/tcp
fi

echo ""
echo "🎉 Готово! Порты 80 и 443 (Xray) не затронуты."
echo "👉 Открывайте покер с работающей камерой и микрофоном:"
echo "   https://${DOMAIN}:8443"
