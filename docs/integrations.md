# Integrations — how to connect each one

Credentials are entered in **Integration Hub**, encrypted with `MASTER_KEY`, and tested immediately. Give every integration the **least access that works**. Read-only keys are enough for monitoring; write scopes are only needed for actions you'll approve.

| Connector | What to create | Minimum access | Default API version |
|---|---|---|---|
| **GitHub** | Fine-grained personal access token, scoped to the storefront repo only | Contents R/W, Pull requests R/W, Commit statuses R, Checks R | REST `2022-11-28` |
| **Vercel** | Account token (Settings → Tokens) + Project ID (+ Team ID if the project is in a team) | Read deployments; promote only if you'll approve promotions | REST v6/v9/v10 |
| **Rootellect storefront API** | Add a read-only ops endpoint to the storefront (contract below) and a long random token | Read orders only | — |
| **Razorpay** | API key (Dashboard → Settings → API Keys). **Start with `rzp_test_…`** | Read payments; refunds only via approvals | v1 |
| **Shiprocket** | A dedicated API user (Settings → API → Create API User) | Read orders/shipments | external v1 |
| **GA4** | Google Cloud service account → JSON key; add its email as **Viewer** on the GA4 property | analytics.readonly | Data API v1beta |
| **Search Console** | Same service account; add as a **restricted user** on the property (`sc-domain:rootellect.com`) | webmasters.readonly | v3 |
| **Google Ads** | Developer token (API Center), OAuth client (Desktop), refresh token for an account with access, customer ID (+ MCC ID) | Read; budget mutations only via approvals | **v26** (Oct 2026; v26.2 is the current minor) |
| **Merchant Center** | Service account added as a user in Merchant Center; Merchant ID | content scope (read product status) | Merchant API **v1** (Content API was sunset 18 Aug 2026) |
| **Meta Ads** | Business Manager **system user** token with `ads_read` (+ `ads_management` for approved changes); ad account `act_…` | ads_read | Graph **v26.0** |
| **Omnisend** | API key (Store settings → API keys) | Read contacts/campaigns | `2026-03-15` (`/api/` base, `Authorization: Omnisend-API-Key`) |
| **Amazon SP-API** | Register a private SP-API app in Seller Central → LWA client ID/secret + refresh token; Seller ID | Orders, Listings (read) | Listings 2021-08-01, Orders v0; India uses the EU endpoint, marketplace `A21TJRUUN4KGV` |
| **Flipkart** | Only if Flipkart has granted Seller API access: app ID/secret | — | Otherwise weekly human-assisted checks are created |
| **Nykaa** | No public seller API is assumed | — | Human-assisted checks |
| **WhatsApp Business Platform** | Meta app with WhatsApp product, permanent system-user token, phone number ID, app secret, a webhook verify token you choose; **an approved utility template** for alerts | whatsapp_business_messaging | Graph **v26.0** |
| **Email (SMTP)** | Google Workspace app password, Zoho, SES, etc. | Send | — |
| **Exotel** | Account SID, API key/token, an ExoPhone caller ID, and a voice flow (app) that reads a short alert | Calls | v1 (`api.exotel.com` or `api.in.exotel.com`) |
| **Google Calendar** | OAuth client + refresh token with `calendar.readonly` | Read | v3 |

Versions are fields on each connector, so upgrading is a settings change. The API Integration Engineer (B05) gets a repair task whenever a health check starts failing.

## WhatsApp webhook

- Callback URL: `https://<your-dashboard-host>/api/webhooks/whatsapp`
- Verify token: the value you entered in the connector.
- Subscribe to `messages`.
- Only messages from the **founder WhatsApp number** in Settings are acted on. Every delivery's `X-Hub-Signature-256` is verified with the app secret, and duplicate deliveries are ignored by message ID.
- Commands that work over WhatsApp: "show pending approvals", "today's sales", "start a website audit", "pause all production-changing actions", `approve AP-XXXXX` / `reject AP-XXXXX` / `defer AP-XXXXX` (approve works for **level ≤ 2 only**; level 3+ replies with the dashboard link).
- Business-initiated messages outside the 24-hour window require an approved template (`alertTemplate`). Without one, alerts only reach you if you've messaged the number in the last 24 hours.

## Storefront ops endpoint (contract)

Add to the storefront (read-only, behind a bearer token, never public):

```
GET /api/ops/orders?since=<ISO8601>&limit=<n>
Authorization: Bearer <token>
→ 200 { "orders": [ { "id": "RT-1042", "razorpayOrderId": "order_…", "razorpayPaymentId": "pay_…",
                       "status": "paid|cancelled|refunded", "totalInr": 1798, "createdAt": "…",
                       "shiprocketOrderId": 123456 | null } ] }
```

Return no customer names, emails, phones or addresses. Reconciliation only needs IDs, amounts and status. Until this exists, reconciliation matches Razorpay directly against Shiprocket.

## Production-safe testing

- Live site: synthetic GET checks and read-only browser journeys (they may add to a throwaway cart and open checkout; they never enter details or pay).
- Transactions: use **Razorpay test mode** on a staging URL (Settings → Staging URL). The OS never creates real charges or orders to test.
