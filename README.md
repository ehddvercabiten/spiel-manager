# Region Spiel Manager — React + TypeScript

A React/TypeScript application with a Node/Express API and a private Excel workbook for spiel templates.

## Key behavior
- Select a support region independently of the spiel.
- Select a spiel; the app fetches online time and replaces every `{{TIME}}` placeholder automatically.
- The generated spiel is read-only and has a Copy button.
- The management tab requires a server-verified administrator PIN.
- Add, edit, deactivate and delete templates directly; changes are written to the Excel workbook on the server.
- Incorrect PIN attempts are recorded in a private file and limited to 5 per IP and 10 globally per rolling 15-minute window.
- Admin sessions are stored server-side in a private folder and expire after 15 minutes.
- The workbook is stored in `data/spiel-templates.xlsx`, not in `public/` or the React build output. Express does not expose the `data/` directory as static files.

## Requirements
- Node.js 20 or newer
- npm
- Internet access for online time synchronization and initial npm package installation

## First-time setup
1. Extract the project ZIP.
2. Open a terminal in the project root.
3. Install packages:

   ```bash
   npm install
   ```

4. Create `.env` by copying `.env.example`.
5. Generate an administrator PIN hash. Use a strong PIN/passphrase of at least 8 characters (12+ characters recommended):

   ```bash
   npm run hash-pin -- "your-long-admin-pin"
   ```

6. Copy the printed bcrypt hash into `ADMIN_PIN_HASH` in `.env`.
7. Generate a session secret. For example, in a terminal:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

8. Put that output in `SESSION_SECRET` in `.env`.
9. Start development mode:

   ```bash
   npm run dev
   ```

10. Open `http://localhost:5173`.

## Excel workbook
The workbook is at `data/spiel-templates.xlsx`. It has one worksheet named `SpielTemplates` and these columns:

| Column | Purpose |
|---|---|
| ID | Unique template ID |
| TemplateName | Name shown in the spiel dropdown |
| Spiel | Template text |
| Active | TRUE shows the spiel to users; FALSE hides it |

Every spiel must contain the exact placeholder `{{TIME}}`. It can appear more than once. It is not tied to a particular region. The selected region is a separate control in the main tab.

If the workbook is missing on first start, the backend creates a starter workbook automatically.

## Security model and important deployment notes
- Do not move the workbook into `public/`, `src/assets/`, or `dist/`. Those are intended for browser-accessible files.
- Do not add an Express static route for `data/`.
- The browser receives the active spiel text through the application API when a user selects it. The actual `.xlsx` file is not served and cannot be opened by guessing a `/data/spiel-templates.xlsx` URL.
- Admin PIN hashes and session secrets belong only in server environment variables. Never put them in React environment variables or commit `.env`.
- The admin tab is only a user-interface affordance. Every management API route independently checks the server-side session.
- PIN failures are persisted in `data/admin-login-attempts.json`. Five failures from one IP or ten failures globally in 15 minutes block further login attempts until the rolling window expires.
- The session cookie is HttpOnly, SameSite=Strict and Secure in production. The session data is stored server-side under `data/sessions/`.
- Run behind HTTPS in production. Do not expose the Node server directly over plain HTTP.
- For a multi-instance deployment, replace the file-backed session and lockout stores with a shared Redis/database store and use a shared persistent volume/database for the workbook. The included file-backed approach is for a single Node server instance.
- Keep the `data/` folder on persistent storage. A redeploy or ephemeral container filesystem can otherwise discard workbook edits and lockout state.

## Build and production
Build the React frontend:

```bash
npm run build
```

Start the API and serve the compiled React app from the same origin:

```bash
NODE_ENV=production npm start
```

Set `PORT`, `ADMIN_PIN_HASH`, and `SESSION_SECRET` in the hosting provider's server-side environment settings. Make sure the private `data/` folder is persistent and writable by the Node process. Configure HTTPS at the hosting provider/reverse proxy.

## Online time and region mapping
The server requests UTC from TimeAPI.io and parses its `dateTime` field (the API does not return `unixTime`). If that provider fails, it uses the independent TimeAPI World endpoint, which returns a Unix `unixtime`. The React client formats the returned instant in the selected IANA time zone. If both fail, the app displays an error and does not substitute the computer clock. The region mappings are representative interpretations of the supplied region slide; verify the official internal mapping before operational use. Daylight-saving abbreviations are generated using the IANA time-zone database.


## Cloudflare Workers + D1 migration

The Cloudflare deployment uses `worker/index.ts` and serves the Vite `dist/`
assets from the same Worker origin. The legacy Express files remain in the
repository for reference/local rollback; they are not part of the Worker entry.

### First-time setup

1. Install dependencies with `npm install`.
2. Authenticate: `npx wrangler login`.
3. Create the D1 database: `npm run db:create`.
4. Copy the returned database ID into `wrangler.jsonc`, replacing
   `REPLACE_WITH_D1_DATABASE_ID`.
5. Apply the initial schema: `npm run db:migrate:production`.
6. Set the existing bcrypt PIN hash as a Worker secret:
   `npx wrangler secret put ADMIN_PIN_HASH`.
   Paste the existing value from your private `.env` when prompted. The uploaded
   ZIP did not contain `.env`, so it cannot recover or verify that hash.
7. Prepare the Excel import SQL:
   `npm run db:import:prepare`.
8. Review `migrations/0002_import_existing_templates.sql`, then apply it:
   `npx wrangler d1 execute spiel-manager-db --remote --file=migrations/0002_import_existing_templates.sql`.
9. Deploy: `npm run deploy`.

### Local Worker development

Create `.dev.vars` from `.dev.vars.example` and insert your existing
`ADMIN_PIN_HASH`. Apply local migrations with `npm run db:migrate:local`,
then run `npx wrangler dev`.

### Important migration notes

- The workbook is imported into D1; the original `data/spiel-templates.xlsx`
  remains in the repository as a backup and is not served to browsers.
- The production Worker uses D1 for templates, sessions, and failed login attempts.
- The current bcrypt PIN hash is a secret and must be copied from your private
  environment; it is not present in the uploaded source archive.
- `SESSION_SECRET` and file-backed sessions are no longer used by the Worker.
  Session tokens are random, stored only as SHA-256 hashes in D1, and expire
  after 15 minutes.
- API routes preserve the response shapes expected by the existing React app.
- Free-plan quotas apply. Monitor Workers and D1 usage in the Cloudflare dashboard.
