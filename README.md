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

## Subscription and Maya Checkout

- Free accounts receive 300 copy actions per UTC calendar month.
- Both Copy time and Copy spiel consume one copy action.
- Premium costs PHP 49 for 30 days. This is a one-time Maya Checkout payment; renewal is user-initiated, not automatic recurring billing.
- Users register with email/password. Password minimum is 10 characters.
- The Worker enforces the copy allowance server-side.
- Set Worker secrets: `ADMIN_PIN_HASH` (existing bcrypt hash), `MAYA_PUBLIC_KEY` (Maya Checkout public API key). Never expose the key in frontend code.
- Set Worker vars: `MAYA_ENV=sandbox` for testing or `production` for live; `APP_BASE_URL=https://your-worker-domain`.
- Maya Checkout onboarding and active API credentials are required before payments can be processed.
- Register `https://YOUR-WORKER-URL/api/payments/maya/webhook` for `PAYMENT_SUCCESS` in Maya Manager.
- The webhook accepts documented Maya environment IP addresses and processes `PAYMENT_SUCCESS`.
- Each 30-day renewal requires a new checkout; this is not an automatic recurring card/wallet mandate.


## Manual GCash subscription payments (₱49 / 30 days)

This build uses manual payment review. It does not call Maya Checkout or any payment gateway. A customer creates an account, scans the configured QR image, submits a GCash transaction reference and receipt, and waits for an administrator to verify the incoming transaction in the receiving account. Only admin approval activates Premium.

### Before deployment

1. Confirm with GCash that the receiving account and QR may be used for your intended online subscription payments. The included QR is a non-payable demo placeholder. Do not replace it with a personal QR unless GCash has authorized that use.
2. In Cloudflare, create an R2 bucket named `spiel-manager-payment-receipts` (or change the bucket name in `wrangler.jsonc`). Keep it private; do not enable public access.
3. Confirm the D1 database ID in `wrangler.jsonc`. Do not recreate the database or re-import the workbook.
4. From the project root run `npm ci`, `npm run build`, then `npx wrangler r2 bucket create spiel-manager-payment-receipts` if the bucket does not exist.
5. Apply migrations with `npx wrangler d1 migrations apply spiel-manager-db --remote`. The migration runner applies only migrations not yet applied.
6. Deploy with `npx wrangler deploy`.

### Payment review

- Customer registration is open. Passwords must be at least 10 characters.
- Free users receive 300 copies per UTC calendar month. Both Copy time and Copy spiel call the Worker usage endpoint.
- The customer submits ₱49 payment reference, optional payment date, and a PNG/JPG/WebP receipt (max 5 MB). Receipt files are stored in the private R2 bucket.
- The admin opens Spiel Management, unlocks with the existing admin PIN, then uses Payment Approvals. Open each receipt and independently verify the incoming payment in the GCash receiving account before approving.
- Approval activates 30 days from now or extends from the later existing Premium expiry. Duplicate payment references are rejected.
- A screenshot is not proof of settlement. Never approve based only on the uploaded image.

### Replacing the demo QR

Replace `public/payment/gcash-qr-placeholder.png` with your authorized merchant receiving QR, retaining the same filename, then rebuild and redeploy the static assets. The placeholder encodes demo text only and cannot receive money.

### Important rollout checks

This implementation is a first integration baseline. Before public commercial launch, add email verification, password reset, login/registration rate limiting, admin audit logging, and a documented privacy/retention policy for uploaded payment receipts. Test with non-production users and small authorized payments first.
