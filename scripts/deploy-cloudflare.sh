#!/usr/bin/env bash
set -euo pipefail
echo "=== Region Spiel Manager: Cloudflare deployment ==="
command -v node >/dev/null || { echo "Node.js is required."; exit 1; }
command -v npm >/dev/null || { echo "npm is required."; exit 1; }
[ -f wrangler.jsonc ] || { echo "Run from project root."; exit 1; }
if grep -q "REPLACE_WITH_D1_DATABASE_ID" wrangler.jsonc; then
  echo "Set the D1 database_id in wrangler.jsonc first."; exit 1
fi
npm ci
npm run build
npx wrangler whoami
echo "Applying D1 migrations..."
npx wrangler d1 migrations apply spiel-manager-db --remote
echo "Deploying Worker and frontend assets..."
npx wrangler deploy
echo "Deployment complete. Check the Worker URL and /api/health."
