#!/usr/bin/env bash
# On a VPS there is no Vercel Cron, so a system crontab calls the same endpoint
# daily at 03:00 UTC with the CRON_SECRET from .env.
#
#   cd /var/www/gmb-tracker && bash deploy/install-cron.sh

set -euo pipefail
cd "$(dirname "$0")/.."

# Read values without sourcing (.env may contain unquoted spaces, e.g. CRON_SCHEDULE=0 3 * * *)
getenv() { sed -n "s/^$1=//p" .env | tail -1 | sed -e 's/^"//' -e 's/"$//'; }
CRON_SECRET="$(getenv CRON_SECRET)"
CRON_SCHEDULE="$(getenv CRON_SCHEDULE)"
[[ -z "$CRON_SCHEDULE" ]] && CRON_SCHEDULE="0 3 * * *"

: "${CRON_SECRET:?CRON_SECRET is not set in .env}"

APP_DIR="$(pwd)"
LOG="${APP_DIR}/logs/cron.log"
URL="${CRON_URL:-http://127.0.0.1:${PORT:-3000}/api/cron/check-gmb}"

# curl: 15 min max, write summary + timestamp to the log
LINE="${CRON_SCHEDULE} curl -sS -m 900 -H \"Authorization: Bearer ${CRON_SECRET}\" ${URL} >> ${LOG} 2>&1 && echo \" [\$(date -u +\\%FT\\%TZ)]\" >> ${LOG}"

mkdir -p "${APP_DIR}/logs"

# Replace any previous entry for this endpoint, keep everything else.
( crontab -l 2>/dev/null | grep -v 'api/cron/check-gmb' || true; echo "${LINE}" ) | crontab -

echo "Installed crontab entry (${CRON_SCHEDULE} UTC):"
crontab -l | grep 'api/cron/check-gmb'
echo
echo "Run it now to test:"
echo "  curl -sS -H \"Authorization: Bearer \$CRON_SECRET\" ${URL} | head -c 600"
