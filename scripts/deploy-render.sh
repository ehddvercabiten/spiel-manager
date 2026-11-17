#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="Region Spiel Manager"
BRANCH="main"

echo
echo "========================================"
echo "  ${PROJECT_NAME} - RENDER DEPLOY"
echo "========================================"
echo

if [ ! -f package.json ]; then
  echo "ERROR: Run this script from the project root."
  exit 1
fi

command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js is not installed."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "ERROR: npm is not installed."; exit 1; }
command -v git >/dev/null 2>&1 || { echo "ERROR: Git is not installed."; exit 1; }

echo "[1/4] Checking Node.js and npm..."
node --version
npm --version

echo
echo "[2/4] Installing dependencies..."
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

echo
echo "[3/4] Building frontend and backend..."
npm run build

if [ ! -f dist/index.html ] || [ ! -f dist-server/index.js ]; then
  echo "ERROR: Expected frontend/backend build outputs were not created."
  exit 1
fi

echo
echo "[4/4] Pushing committed changes to GitHub..."
CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  echo "ERROR: Current branch is '$CURRENT_BRANCH'. Switch to '$BRANCH' before deploying."
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: You have uncommitted changes."
  echo "Commit your changes first, then run this script again."
  exit 1
fi

git push origin "$BRANCH"

echo
echo "Deployment trigger sent."
echo "Render will build and deploy the latest commit automatically"
echo "if the Render service is connected to this repository and branch."
echo
