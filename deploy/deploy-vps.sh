#!/usr/bin/env bash
# Deploy GMB Guard to the Ubuntu VPS using SSH key auth.
#
#   bash deploy/deploy-vps.sh
#
# Requires: ~/.ssh/gmb_vps private key authorised on the server.

set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${VPS_HOST:-144.79.218.148}"
USER="${VPS_USER:-root}"
KEY="${VPS_KEY:-$HOME/.ssh/gmb_vps}"
DOMAIN="${DOMAIN:-gmb.client-flow.xyz}"
REPO_URL="${REPO_URL:-https://github.com/mdnishath/gmb-guard.git}"
APP_DIR="${APP_DIR:-/var/www/gmb-guard}"
ENV_FILE="${ENV_FILE:-deploy/.vps.env}"

SSH="ssh -i $KEY -o StrictHostKeyChecking=no -o ConnectTimeout=20 $USER@$HOST"

echo "==> connectivity"
$SSH 'echo connected as $(whoami) on $(hostname)'

if [[ -f "$ENV_FILE" ]]; then
  echo "==> uploading .env"
  scp -i "$KEY" -o StrictHostKeyChecking=no "$ENV_FILE" "$USER@$HOST:/tmp/gmb.env"
fi

echo "==> uploading setup script"
scp -i "$KEY" -o StrictHostKeyChecking=no deploy/remote-setup.sh "$USER@$HOST:/tmp/gmb-remote.sh"

echo "==> running remote setup"
$SSH "DOMAIN='$DOMAIN' REPO_URL='$REPO_URL' APP_DIR='$APP_DIR' bash /tmp/gmb-remote.sh"
