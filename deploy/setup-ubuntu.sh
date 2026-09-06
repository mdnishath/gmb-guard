#!/usr/bin/env bash
# One-time server bootstrap for Ubuntu 22.04 / 24.04.
# Installs Node 20, PM2, nginx and build tools (for the SQLite native module).
#
#   sudo bash deploy/setup-ubuntu.sh
#
# Afterwards: copy the repo to /var/www/gmb-tracker, create .env, then run deploy/deploy.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/gmb-tracker}"

echo "==> apt packages"
apt-get update -y
apt-get install -y curl git nginx ufw build-essential python3 sqlite3

echo "==> Node.js 20 (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -c2-3)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v && npm -v

echo "==> PM2"
npm install -g pm2

echo "==> app directory"
mkdir -p "${APP_DIR}/logs" "${APP_DIR}/data"

echo "==> firewall"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

cat <<EOF

============================================================
Server ready. The database is a SQLite file at ${APP_DIR}/data/gmb.sqlite
(created automatically on first start — back that file up).

Next steps:
  1. Copy the project to ${APP_DIR}  (git clone or rsync)
  2. cp .env.example .env && nano .env      # fill every value
  3. bash deploy/deploy.sh                   # install, build, start
  4. bash deploy/install-cron.sh             # daily 03:00 UTC check
  5. Copy deploy/nginx.conf to /etc/nginx/sites-available/gmb-tracker,
     set server_name, then:  ln -s ... sites-enabled/ && nginx -t && systemctl reload nginx
  6. (optional) certbot --nginx -d yourdomain.com
============================================================
EOF
