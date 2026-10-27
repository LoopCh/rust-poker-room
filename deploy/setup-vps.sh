#!/usr/bin/env bash
# Безопасная настройка VPS (Ubuntu / Debian) по IP-адресу рядом с нодой Xray
# НЕ трогает порты 443 и 80 (где работает Xray)!
# Запуск на VPS: sudo bash setup-vps.sh

set -euo pipefail

BINARY_PATH="/usr/local/bin/rust-poker-room"
SERVICE_NAME="rust-poker"
VPS_IP=$(curl -s4 ifconfig.me || hostname -I | awk '{print $1}')

echo "=== 1. Создание systemd-сервиса ${SERVICE_NAME}.service (порт 3000) ==="
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
echo "✅ Сервис ${SERVICE_NAME} зарегистрирован (порт 3000)."

echo "=== 2. Настройка HTTPS на порту 8443 (для работы WebRTC-камер по IP без конфликта с Xray на 443) ==="
if ! command -v caddy &>/dev/null; then
    apt-get update
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
fi

# Важно: отключаем редиректы на 80/443, чтобы НЕ конфликтовать с Xray!
cat >/etc/caddy/Caddyfile <<EOF
{
    auto_https disable_redirects
    http_port 8088
    https_port 8443
}

https://:8443 {
    tls internal
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
EOF

systemctl restart caddy

# Если включен файрвол ufw — открываем порты 3000 и 8443
if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
    ufw allow 3000/tcp
    ufw allow 8443/tcp
fi

echo ""
echo "🎉 Готово! Xray на порту 443 не затронут."
echo "👉 Вход без камеры (HTTP):  http://${VPS_IP}:3000"
echo "👉 Вход с камерой (HTTPS):  https://${VPS_IP}:8443 (при первом входе нажмите «Дополнительно -> Перейти» для самоподписанного сертификата)"
