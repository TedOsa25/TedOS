# Connector Setup — concrete steps (no placeholders)

The growth/revenue/conversion loops are **data-gated**: rankings, traffic, conversion rates and outreach need these connectors. Provision them, then the watchdogs ingest real numbers and prioritize by actual impact. All env vars go in the server/edge environment — **never** ship secrets to the client bundle.

## 1. Google Search Console (organic traffic, CTR, rankings, impressions)
1. Google Cloud Console → create/select a project → enable **Search Console API**.
2. Create a **service account** → create a JSON key → download.
3. In Search Console → property `https://heycarbo.com` → Settings → Users and permissions → add the service-account email as **Full/Restricted (read)**.
4. Env: `GSC_SERVICE_ACCOUNT_JSON` (the key JSON), `GSC_SITE_URL=https://heycarbo.com`.
5. Scope: `https://www.googleapis.com/auth/webmasters.readonly`. Endpoint: `searchanalytics.query`.

## 2. GA4 (sessions, conversion rate, trial/demo events, bounce)
1. Google Cloud → enable **Google Analytics Data API**.
2. Reuse the service account → in GA4 Admin → Property Access Management → add it as **Viewer**.
3. Env: `GA4_PROPERTY_ID` (numeric), `GA4_SERVICE_ACCOUNT_JSON`.
4. Endpoint: Data API v1 `runReport`. Define key events: `sign_up`, `trial_start`, `demo_booked`, `supplier_registered`.

## 3. LinkedIn (organic publish + post analytics)
1. LinkedIn Developer Portal → create an app, link the HeyCarbo Company Page.
2. Request products: **Share on LinkedIn** + **Community Management API** (org posts + analytics). Note: org analytics requires app review/approval.
3. OAuth2 (3-legged) → store refresh token. Env: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_TOKEN` (access), `LINKEDIN_ORG` (urn:li:organization:ID).
4. Until approved: drafts only (the `LinkedInConnector` reports `canPublish()=false`).

## 4. Instagram (organic publish + insights)
1. Requires a **Meta app** + **Instagram Business/Creator account** linked to a Facebook Page.
2. Use the **Instagram Graph API** (Content Publishing + Insights). Submit for App Review (instagram_content_publish, instagram_manage_insights).
3. Env: `INSTAGRAM_TOKEN` (long-lived page token), `INSTAGRAM_ACCOUNT` (IG business account ID).
4. Until approved: drafts only (`InstagramConnector.canPublish()=false`).

## 5. CRM + Stripe (leads, pipeline, MRR, trial→paid)
- CRM: `CRM_API_BASE`, `CRM_API_KEY` (or reuse `/Sales` exports).
- Stripe: `STRIPE_SECRET_KEY` (server/edge only) → subscriptions + checkout sessions for conversion + revenue KPIs.

## 6. Gmail (Sales/Customer-Success outreach — send)
1. Google Cloud → enable **Gmail API**.
2. OAuth consent screen → scopes **`https://www.googleapis.com/auth/gmail.send`** (send only; no read needed for outreach). For a workspace, prefer a **service account with domain-wide delegation** to send as a mailbox.
3. OAuth2 (3-legged) → store refresh token. **Redirect URL:** `https://heycarbo.com/oauth/gmail/callback` (+ `http://localhost:5173/oauth/gmail/callback` for dev).
4. Env: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_TOKEN` (access/refresh), optional `GMAIL_SENDER`.
5. **Endpoint:** `POST users/me/messages/send` (RFC 822, base64url). **Health check:** `GET users/me/profile`. **Test call:** the Distribution Engine's `Publisher.testCall()` confirms the token without sending.

## 7. Web / Landing & SEO pages (Growth — publish)
1. Vercel → project token (read/deploy). **Env:** `VERCEL_TOKEN` (+ `VERCEL_PROJECT`). Content/SEO source lives in the HeyCarbo repo (Supabase for data).
2. **Endpoint:** Vercel Deployments API (`POST /v13/deployments`). **Health check:** `GET /v2/user`. **Test call:** dry-run resolve of the project without deploying.
3. Web publishing remains **no-deploy by default** in TedOS — a `web` job is `skipped` with this setup hint until a deploy transport is explicitly wired.

## Distribution (publish/send) — activation summary
The Distribution Engine (`docs/distribution-engine.md`) is **gated twice**: (1) the `*_TOKEN` env above must be present, and (2) a live `Transport` must be injected. Until both exist, approved jobs are recorded `skipped` with the exact hint above — **nothing is published or sent**.

| Channel | Scope/Product | Env | Health check | Test call |
|---|---|---|---|---|
| LinkedIn (§3) | `w_organization_social` (org post) + Community Mgmt | `LINKEDIN_TOKEN`,`LINKEDIN_ORG` | `GET /v2/organizationalEntityAcls` | `Publisher.testCall()` (no post) |
| Instagram (§4) | `instagram_content_publish` | `INSTAGRAM_TOKEN`,`INSTAGRAM_ACCOUNT` | `GET /{ig-user-id}` | `Publisher.testCall()` (no post) |
| Gmail (§6) | `gmail.send` | `GMAIL_TOKEN` | `GET users/me/profile` | `Publisher.testCall()` (no send) |
| Web (§7) | Vercel deploy | `VERCEL_TOKEN`,`VERCEL_PROJECT` | `GET /v2/user` | dry-run resolve (no deploy) |

`PublisherRegistry.healthReport(env)` returns the live health of every channel for the Connector Health Check.

## After provisioning
Set the env vars → connector `status()` flips to configured → the Growth/Revenue/Marketing watchdogs read live data → Revenue KPIs in the Executive Report show real values instead of "pending (no connector)". For distribution, additionally wire a `Transport` per channel so approved jobs publish/send instead of `skipped`.
