# Custom Screenshot — license Worker (Cloudflare)

Server side of Razorpay test-mode licensing. The extension (MV3 — remote
JS forbidden) never touches Razorpay keys; it POSTs here, opens the
Razorpay-hosted Payment Link in a normal tab, then polls `GET /api/license`.

## Prices — OWNER-TBD, clearly marked

`src/index.ts` → `PLANS` (smallest currency unit):

| plan      | amount | currency | label              |
|-----------|--------|----------|--------------------|
| `pro`     | 900    | USD      | Pixel Pro — $9 one-time |
| `proplus` | 1900   | USD      | Pro+ bulk tier — $19 (UI later) |

> ⚠️ **USD / India-activation flag:** Razorpay India accounts may need
> international payments activated to capture USD. Test mode works either
> way — confirm with the owner before going live; if USD capture fails,
> switch `currency` (and amounts) in `PLANS` and redeploy. No client change
> needed (the Worker owns amounts).

## Deploy steps (owner)

1. **Cloudflare account** — sign up at https://dash.cloudflare.com (free),
   then `npm i -g wrangler && wrangler login`.
2. **KV namespace** for licenses:
   ```
   wrangler kv:namespace create LICENSES
   ```
   Paste the returned `id` into `wrangler.toml` (`[[kv_namespaces]]`).
   For local dev: `wrangler kv:namespace create LICENSES --preview` and set
   `preview_id`.
3. **Secrets** (never in files — Owner pasted test keys in chat only):
   ```
   wrangler secret put RAZORPAY_KEY_ID
   wrangler secret put RAZORPAY_KEY_SECRET
   wrangler secret put RAZORPAY_WEBHOOK_SECRET
   ```
   (`RAZORPAY_WEBHOOK_SECRET` is created in the Razorpay dashboard, step 5.)
4. **Allowed extension origins** — edit `wrangler.toml` `[vars]`:
   `ALLOWED_ORIGINS = "chrome-extension://<dev-id>,chrome-extension://<store-id>"`.
   The ID changes per build (`chrome://extensions`); add each ID that should
   be able to buy/check licenses.
5. **Deploy**: `wrangler deploy`. Note the URL, e.g.
   `https://custom-screenshot-license.<account>.workers.dev`.
6. **Razorpay dashboard** (test mode) → Settings → Webhooks → Add webhook:
   URL = `<worker-url>/api/webhook`, event = `payment_link.paid`,
   copy the webhook secret → step 3. Re-deploy not needed (secret via env).
7. **Extension wiring**: paste the Worker URL into `src/lib/pro.ts`
   `WORKER_URL` (replaces the `REPLACE-WITH-WORKER` placeholder).

## Endpoints

- `POST /api/order {email, plan}` → creates a Razorpay Payment Link
  (Basic-auth with Key ID/Secret, server-side only) → `{link_url, link_id}`.
  Validates email + plan; Authorization header is redacted in all logging.
- `POST /api/webhook` → verifies `x-razorpay-signature` (HMAC-SHA256 of the
  raw body with the webhook secret) → on `payment_link.paid` writes
  `{email, plan, link_id, paid_at}` to KV. Bad signature → 401, no write.
- `GET /api/license?email=` → `{pro, plan}` from KV.

## Local check (no account needed)

```
node --check src/index.js   # if using the JS variant
# or: npx tsc --noEmit -p .
```
