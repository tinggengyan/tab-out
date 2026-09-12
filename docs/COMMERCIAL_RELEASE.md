# Commercial release runbook

## One-time configuration

1. Run `npm run license:keygen` in a secure offline environment.
2. Store `privateKeyJwk` in a secret manager. Never commit it or place it in the extension.
3. Put only `publicKeyJwk` into `extension/entitlement-config.js` as `TAB_OUT_PUBLIC_KEY_JWK`.
4. Configure the two Lemon Squeezy variant checkout URLs in `TAB_OUT_CHECKOUT_URLS` (the single `TAB_OUT_CHECKOUT_URL` fallback is intended only for a router page).
5. Deploy `server/worker.mjs` at the exact host allowed by `manifest.json`, configure its Lemon Squeezy store/variant IDs and secrets, then set `TAB_OUT_REDEMPTION_URL`.
6. Create the `LICENSE_STATE` KV binding, set `LEMON_WEBHOOK_SECRET`, and configure Lemon Squeezy to send signed events to `POST /webhooks/lemon`.
7. Enable Lemon Squeezy license keys for both variants and test activation, daily validation, expiration, disabling/refund, subscription expiry, offline use, webhook signature rejection, and activation limits in provider test mode.
8. `tools/license-issue.mjs` remains available for a controlled offline beta.
9. Replace the placeholder support contact and obtain legal review of the privacy policy and terms.

## License behavior

- `pro_lifetime` works offline after activation.
- `sync` expires at `expiresAt`, then receives a seven-day offline grace period.
- Invalid or modified tokens are rejected.
- Signed refund and subscription-expiry webhooks create minimal revocation markers; raw webhook and customer data are not stored.
- Downgrade prevents creating paid resources or running automation; existing local data remains readable, restorable, and exportable.

## Release gate

- Run `npm test`, `npm run check`, and manifest JSON validation.
- Load `extension/` unpacked in a clean Chrome profile and complete the six journeys in `DEVELOPMENT_PLAN.md` §9.3.
- Add final checkout-provider privacy links, seller identity, support email, screenshots, and store listing copy.
- Verify refund/revocation behavior against the production signing service.

The repository intentionally does not contain a payment private key, webhook secret, or analytics credential.
