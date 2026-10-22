#!/bin/bash
# sync-config.sh — Haalt config op van het govchat-admin panel
# en schrijft deze naar de static files directory.
# Draait als achtergrondproces in de Open WebUI container.
# Gebruikt Python (al aanwezig in het image) in plaats van curl.

ADMIN_URL="${GOVCHAT_ADMIN_URL:-http://govchat-admin:3002}"
STATIC_DIR="/app/backend/static"
INTERVAL="${GOVCHAT_SYNC_INTERVAL:-60}"

sleep 15

while true; do
  python3 -c "
import urllib.request
try:
    urllib.request.urlretrieve('${ADMIN_URL}/api/config/help-content', '${STATIC_DIR}/help-content.json')
except: pass
try:
    urllib.request.urlretrieve('${ADMIN_URL}/api/config/apps', '${STATIC_DIR}/apps.json')
except: pass
" 2>/dev/null
  sleep "$INTERVAL"
done
