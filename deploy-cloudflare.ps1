
param(
    [string]$ProjectName = "spiel-manager",
    [string]$Branch = "main",
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   SPIEL MANAGER - CLOUDFLARE DEPLOY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verify project directory
if (-not (Test-Path "package.json")) {
    throw "package.json not found. Run this script from the project root."
}

# 2. Verify Node.js and npm
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is not installed."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is not installed."
}

Write-Host "[1/5] Checking environment..." -ForegroundColor Yellow
node --version
npm --version

# 3. Install dependencies
if (-not $SkipInstall) {
    Write-Host ""
    Write-Host "[2/5] Installing dependencies..." -ForegroundColor Yellow

    if (Test-Path "package-lock.json") {
        npm ci
    }
    else {
        npm install
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Dependency installation failed."
    }
}
else {
    Write-Host "[2/5] Skipping dependency installation." -ForegroundColor DarkGray
}

# 4. Build React application
Write-Host ""
Write-Host "[3/5] Building React application..." -ForegroundColor Yellow

npm run build

if ($LASTEXITCODE -ne 0) {
    throw "React build failed. Deployment cancelled."
}

# 5. Verify build output
Write-Host ""
Write-Host "[4/5] Verifying build output..." -ForegroundColor Yellow

if (-not (Test-Path "dist/index.html")) {
    throw "dist/index.html not found. Check your Vite build configuration."
}

Write-Host "Build output verified: dist/" -ForegroundColor Green

# 6. Verify Cloudflare authentication
Write-Host ""
Write-Host "[5/5] Checking Cloudflare authentication..." -ForegroundColor Yellow

npx wrangler whoami

if ($LASTEXITCODE -ne 0) {
    throw "Cloudflare authentication failed. Run: npx wrangler login"
}

# 7. Deploy to Cloudflare Pages
Write-Host ""
Write-Host "Deploying to Cloudflare Pages..." -ForegroundColor Yellow
Write-Host "Project: $ProjectName"
Write-Host "Branch:  $Branch"

npx wrangler pages deploy dist `
    --project-name $ProjectName `
    --branch $Branch

if ($LASTEXITCODE -ne 0) {
    throw "Cloudflare deployment failed."
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "   DEPLOYMENT COMPLETED" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Website: https://$ProjectName.pages.dev" -ForegroundColor Cyan
Write-Host ""
