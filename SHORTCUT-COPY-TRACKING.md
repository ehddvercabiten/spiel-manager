# Keyboard and context-menu copy tracking

The Spiel Generator now intercepts browser copy events for the generated spiel textarea and the displayed online time.

- `Ctrl+C` on Windows/Linux and `Cmd+C` on macOS are covered.
- The browser context-menu **Copy** action is covered.
- Copying unrelated page text is not counted.
- Shortcut copies use the existing `POST /api/usage/copy` Worker endpoint, so they share the same monthly allowance and Premium rules as the Copy buttons.
- The copy event is paused until the Worker authorizes the copy. If the monthly free limit is reached, the application shows the existing upgrade modal.

## Deployment

No database migration is required. The feature reuses the existing `copy_usage` table and `/api/usage/copy` endpoint.

Build and deploy using the project's existing process. If using the local Wrangler config:

```bash
npm ci
npm run build
npx wrangler deploy --config wrangler.local.jsonc
```

Deploy the frontend to Cloudflare Pages using the project's normal Pages deployment process as well.

## Manual test checklist

1. Sign in with a Free account and note the current monthly copy count.
2. Select part or all of the generated spiel and press `Ctrl+C` (or `Cmd+C` on macOS). Confirm the clipboard receives the selection and the usage count increases by one.
3. Repeat using right-click / **Copy** on the generated spiel.
4. Select the displayed online time and copy it with the keyboard shortcut. Confirm the count increases by one.
5. Copy unrelated text elsewhere on the page. Confirm the count does not increase.
6. Test the Copy time and Copy spiel buttons. Confirm each still increments usage once.
7. Set a test account at its monthly limit and try a shortcut copy. Confirm copying is blocked and the upgrade modal appears.
8. Repeat as a Premium user. Confirm copies work and do not trigger the Free limit.

## Browser limitation

This protects normal browser copy events for the marked output elements. It cannot detect screenshots, developer-tools extraction, manual retyping, or other ways of obtaining text. Clipboard permission behavior can also vary by browser; test on the browsers you support. As with any client-side clipboard feature, the Worker remains the authority for whether a copy is authorized.
