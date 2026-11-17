#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo " Region Spiel Manager - Cloudflare deploy"
echo "=========================================="

command -v node >/dev/null || { echo "Node.js is required."; exit 1; }
command -v npm >/dev/null || { echo "npm is required."; exit 1; }

if [ ! -f wrangler.jsonc ]; then
  echo "wrangler.jsonc not found. Run from the project root."
  exit 1
fi

if grep -q "REPLACE_WITH_D1_DATABASE_ID" wrangler.jsonc; then
  echo "Set the real D1 database_id in wrangler.jsonc first."
  exit 1
fi

echo "[1/5] Installing dependencies..."
npm ci

echo "[2/5] Building React frontend..."
npm run build

echo "[3/5] Applying production D1 migrations..."
npx wrangler d1 migrations apply spiel-manager-db --remote

echo "[4/5] Checking Worker authentication..."
npx wrangler whoami

echo "[5/5] Deploying frontend and backend together..."
npx wrangler deploy

echo
echo "Deployment command completed."
