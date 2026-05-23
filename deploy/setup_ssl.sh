#!/usr/bin/env bash
set -euo pipefail

DOMAIN="aria.d2cgo.co"
NGINX_CONF="/www/wwwroot/AriaAI/deploy/nginx_ariaai.conf"

echo "=== SSL Setup for $DOMAIN ==="

if ! command -v certbot &>/dev/null; then
    echo "Installing certbot..."
    if command -v apt-get &>/dev/null; then
        apt-get update && apt-get install -y certbot python3-certbot-nginx
    elif command -v yum &>/dev/null; then
        yum install -y certbot python3-certbot-nginx
    else
        echo "ERROR: Could not install certbot. Install manually."
        exit 1
    fi
    echo "certbot installed successfully."
else
    echo "certbot is already installed."
fi

echo "Requesting SSL certificate for $DOMAIN..."
certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@d2cgo.co

echo "Copying Nginx config..."
cp "$NGINX_CONF" /etc/nginx/conf.d/ariaai.conf

echo "Testing Nginx config..."
nginx -t

echo "Reloading Nginx..."
nginx -s reload

echo "Setting up auto-renewal..."
CERTBOT_RENEW="0 3 * * * certbot renew --quiet --post-hook 'nginx -s reload'"
(crontab -l 2>/dev/null | grep -v 'certbot renew'; echo "$CERTBOT_RENEW") | crontab -

echo ""
echo "=== SSL setup complete ==="
echo "Certificate: /etc/letsencrypt/live/$DOMAIN/"
echo "Auto-renewal: daily at 03:00"
echo ""
echo "To add daily database backup, run: crontab -e"
echo "Add: 0 2 * * * /www/wwwroot/AriaAI/deploy/backup.sh"
