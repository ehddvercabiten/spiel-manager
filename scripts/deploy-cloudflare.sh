#!/usr/bin/env bash
set -euo pipefail
echo "=== Region Spiel Manager: Cloudflare deployment ==="
command -v node >/dev/null || { echo "Node.js is required."; exit 1; }
command -v npm >/dev/null || { echo "npm is required."; exit 1; }
CONFIG="wrangler.local.jsonc"
if [ ! -f "$CONFIG" ]; then
  CONFIG="wrangler.jsonc"
fi
[ -f "$CONFIG" ] || {
  echo "Create wrangler.local.jsonc (recommended) or wrangler.jsonc in the project root."
  exit 1
}
if grep -q "REPLACE_WITH_D1_DATABASE_ID" "$CONFIG"; then
  echo "Set the real D1 database_id in $CONFIG first."
  exit 1
fi
npm ci
npm run build
npx wrangler whoami
echo "Applying D1 migrations..."
npx wrangler d1 migrations apply spiel-manager-db --remote --config "$CONFIG"
echo "Deploying Worker and frontend assets..."
npx wrangler deploy --config "$CONFIG"
echo "Deployment complete. Check the Worker URL and /api/health."
