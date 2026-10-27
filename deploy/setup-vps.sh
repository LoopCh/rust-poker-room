#!/usr/bin/env bash
# Безопасная настройка VPS (Ubuntu / Debian) для RustHoldem рядом с нодой Xray
# Поддерживает как работу по домену (Let's Encrypt SSL без предупреждений браузера), так и по IP.
# Запуск с доменом: sudo bash setup-vps.sh poker.vikhr.online
# Запуск без домена: sudo bash setup-vps.sh

set -euo pipefail

DOMAIN="${1:-}"
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
    echo "=== Установка Caddy ==="
    apt-get update
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
fi

# Проверяем, занят ли порт 443 другим процессом (например, Xray)
PORT_443_BUSY=0
if ss -tlnp | grep -v "caddy" | grep -q ':443 '; then
    PORT_443_BUSY=1
fi

if [ -n "$DOMAIN" ]; then
    if [ "$PORT_443_BUSY" -eq 1 ]; then
        echo "ℹ️ Порт 443 занят (Xray). Настраиваем официальный Let's Encrypt SSL для ${DOMAIN} на порту 8443 (через HTTP-01 на порту 80)..."
        cat >/etc/caddy/Caddyfile <<EOF
{
    http_port 80
    https_port 8443
    auto_https disable_redirects
}

${DOMAIN}:8443 {
    tls {
        issuer acme {
            disable_tlsalpn_challenge
        }
    }
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
EOF
        TARGET_URL="https://${DOMAIN}:8443"
    else
        echo "✅ Порт 443 свободен. Настраиваем стандартный HTTPS для ${DOMAIN}..."
        cat >/etc/caddy/Caddyfile <<EOF
${DOMAIN} {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
EOF
        TARGET_URL="https://${DOMAIN}"
    fi
else
    echo "ℹ️ Домен не указан. Настраиваем самоподписанный HTTPS по IP на порту 8443..."
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
    TARGET_URL="https://${VPS_IP}:8443"
fi

systemctl restart caddy

if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp
    ufw allow 3000/tcp
    ufw allow 8443/tcp
fi

echo ""
echo "🎉 Готово! Конфигурация Caddy перезапущена."
echo "👉 Открывайте покерный клуб с рабочей камерой и микрофоном по ссылке:"
echo "   ${TARGET_URL}"
