#!/usr/bin/env bash
# Build & (re)start the app. Safe to run on every update.
#
#   cd /var/www/gmb-tracker && bash deploy/deploy.sh

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Copy .env.example to .env and fill it in." >&2
  exit 1
fi

if [[ -d .git ]]; then
  echo "==> git pull"
  git pull --ff-only
fi

echo "==> npm install"
if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

echo "==> next build"
npm run build

echo "==> pm2"
mkdir -p logs data
if pm2 describe gmb-tracker >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

echo
echo "Deployed. Health check:"
sleep 2
curl -s -o /dev/null -w "  GET /api/listings/stats -> HTTP %{http_code}\n" http://127.0.0.1:3000/api/listings/stats || true
