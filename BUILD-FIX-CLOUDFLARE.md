# Cloudflare Pages build fix: `sh: 1: tsc: not found`

The project uses TypeScript, Vite, and the React Vite plugin as build-time tools. They are listed in `devDependencies` in `package.json`.

Cloudflare's build environment installed production dependencies only, so the TypeScript compiler (`tsc`) was missing when the build command ran.

## Included fix

The `.npmrc` file contains:

```ini
include=dev
```

This tells npm to install development dependencies even when the build environment sets `NODE_ENV=production` or otherwise omits development dependencies.

## Cloudflare Pages settings

Use these settings:

- Root directory: `spiel-manager` (only if your repository contains the project inside that subfolder; otherwise leave it blank)
- Build command: `npm run build`
- Build output directory: `dist`

If Cloudflare still omits development dependencies, add this build environment variable:

- `NPM_CONFIG_INCLUDE` = `dev`

Then retry the deployment.

## Local verification

Run from the folder containing `package.json`:

```bash
npm ci --include=dev
npm run build
```

The build was not executed in the packaging environment because dependency installation timed out. Verify locally or in Cloudflare before deploying to production.
