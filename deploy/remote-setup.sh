#!/usr/bin/env bash
# Runs ON the Ubuntu VPS (as root). Idempotent: safe to re-run for updates.
#
#   DOMAIN=gmb.example.com REPO_URL=https://github.com/you/gmb-guard.git bash remote-setup.sh
#
# Expects the app's .env to be uploaded to /tmp/gmb.env (moved into place below).

set -euo pipefail

DOMAIN="${DOMAIN:?DOMAIN is required}"
REPO_URL="${REPO_URL:?REPO_URL is required}"
APP_DIR="${APP_DIR:-/var/www/gmb-guard}"
BRANCH="${BRANCH:-main}"
export DEBIAN_FRONTEND=noninteractive

log() { echo; echo "==> $*"; }

log "apt packages"
apt-get update -y -qq
apt-get install -y -qq curl git nginx ufw build-essential python3 sqlite3 ca-certificates >/dev/null

log "Node.js 20"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v && npm -v

log "PM2"
command -v pm2 >/dev/null 2>&1 || npm install -g pm2 >/dev/null

log "code → ${APP_DIR}"
if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch --all --quiet
  git -C "${APP_DIR}" reset --hard "origin/${BRANCH}" --quiet
else
  rm -rf "${APP_DIR}"
  git clone --quiet --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
fi
mkdir -p "${APP_DIR}/data" "${APP_DIR}/logs"
chmod 700 "${APP_DIR}/data"

log ".env"
if [[ -f /tmp/gmb.env ]]; then
  mv /tmp/gmb.env "${APP_DIR}/.env"
  chmod 600 "${APP_DIR}/.env"
elif [[ ! -f "${APP_DIR}/.env" ]]; then
  echo "ERROR: no /tmp/gmb.env uploaded and no existing .env" >&2
  exit 1
fi

log "npm install + build"
cd "${APP_DIR}"
if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund --loglevel=error; else npm install --no-audit --no-fund --loglevel=error; fi
npm run build

log "PM2 process"
if pm2 describe gmb-tracker >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

log "nginx → ${DOMAIN}"
cat > /etc/nginx/sites-available/gmb-guard <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 600m;
    proxy_read_timeout 900s;
    proxy_send_timeout 900s;

    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX
ln -sf /etc/nginx/sites-available/gmb-guard /etc/nginx/sites-enabled/gmb-guard
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
systemctl enable nginx >/dev/null 2>&1 || true

log "firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

log "daily cron"
bash deploy/install-cron.sh

log "HTTPS (certbot)"
RESOLVED="$(getent hosts "${DOMAIN}" | awk '{print $1}' | head -1 || true)"
MYIP="$(curl -s -4 https://api.ipify.org || true)"
if [[ -n "${RESOLVED}" && "${RESOLVED}" == "${MYIP}" ]]; then
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email --redirect || echo "certbot failed — re-run later: certbot --nginx -d ${DOMAIN}"
else
  echo "DNS for ${DOMAIN} resolves to '${RESOLVED:-nothing}' but this server is ${MYIP}."
  echo "Point an A record for ${DOMAIN} to ${MYIP}, then run:  certbot --nginx -d ${DOMAIN} --redirect"
fi

log "health"
sleep 2
curl -s -o /dev/null -w "local  http://127.0.0.1:3000/api/auth/status -> HTTP %{http_code}\n" http://127.0.0.1:3000/api/auth/status || true
curl -s -o /dev/null -w "public http://${DOMAIN}/api/auth/status      -> HTTP %{http_code}\n" "http://${DOMAIN}/api/auth/status" || true
echo
echo "Done. Open https://${DOMAIN} (or http:// until DNS/SSL is ready) and create the first admin account."
