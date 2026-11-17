# Maintenance notes — Spiel Manager

## Administrator authentication
- `worker/index.ts`: authentication helpers and `/api/admin/*` routes.
- `ADMIN_PENDING_COOKIE` is a five-minute PIN-verified MFA challenge only.
- `ADMIN_COOKIE` is issued only after TOTP verification and is checked by `adminOk`.
- Every protected admin route must call `adminOk`; never authorize by cookie presence alone.
- `migrations/0005_separate_admin_mfa_challenges.sql` creates the pending challenge table and revokes legacy sessions.
- `src/App.tsx` controls presentation only. It is not an authorization boundary.

## Subscription and payments
- `worker/index.ts`: manual payment submission, R2 receipt storage, payment approval, Premium activation, usage enforcement and adjustable feature limit.
- `src/SubscriptionPanel.tsx`: customer payment submission and admin review UI.
- `migrations/0002_subscriptions.sql` and `0003_manual_payments.sql`: account, usage, subscription and payment tables.
- `migrations/0004_security_limits.sql`: TOTP enrollment data and configurable free-copy limit.

## Before deployment
1. Back up the D1 database.
2. Run the production build.
3. Apply migration 0005 to the existing D1 database.
4. Deploy the Worker.
5. Verify PIN-only cannot call `/api/admin/session`, `/api/admin/payments`, `/api/admin/settings` or `/api/admin/templates`.
6. Verify successful TOTP can access these routes.
7. Verify five wrong TOTP codes expire the pending challenge.
