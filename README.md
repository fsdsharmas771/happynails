# Happy Nails by Anamika

Storefront (`apps/web`), owner dashboard (`apps/admin`) and API (`apps/api`) for press-on nail sets shipped across India and home visits in Delhi, Noida and Gurgaon.

The design reference is [`docs/design-reference.html`](docs/design-reference.html). The phased build plan is [`docs/BUILD_PROMPT.md`](docs/BUILD_PROMPT.md).

## Requirements

Docker Desktop (or Docker Engine with Compose v2.24+). Nothing else needs to be installed on the host: Node, pnpm, MongoDB and Redis all run in containers.

## Start

```sh
docker compose up
```

The first run builds the dev image, installs dependencies into named volumes, initiates the Mongo replica set and starts everything. Then open:

| Service    | URL                              |
| ---------- | -------------------------------- |
| Storefront | http://localhost:5173            |
| Admin      | http://localhost:5174            |
| API health | http://localhost:4000/api/health |

Code changes hot-reload: Vite for web and admin, nodemon for the API. Watchers poll because file events do not cross Docker Desktop bind mounts.

## Commands

Run these inside the containers. The api container has the whole repo mounted, so it can run checks for every package.

```sh
docker compose exec api pnpm test        # Vitest in every package
docker compose exec api pnpm lint        # ESLint
docker compose exec api pnpm typecheck   # tsc --noEmit in every package
docker compose exec api pnpm format      # Prettier
docker compose exec api pnpm --filter @happynails/api seed
pnpm e2e                                 # Playwright browser tests (see Testing)
docker compose run --rm install          # after editing any package.json
docker compose down                      # stop (add -v to wipe Mongo, Redis and node_modules volumes)
```

If pnpm is installed on the host, the root scripts `pnpm run up`, `pnpm run down`, `pnpm seed` and `pnpm run logs` wrap the same compose commands. Use `pnpm run up`, not `pnpm up`, which is pnpm's alias for `update`.

## Environment

`docker-compose.yml` supplies working development defaults, so `.env` is optional for now. Copy `.env.example` to `.env` to override anything. Every variable is documented there.

## Connecting to Mongo from the host

The replica set advertises itself as `mongo:27017`, which only resolves inside Docker. From the host, connect with `directConnection=true`:

```
mongodb://localhost:27017/happynails?directConnection=true
```

## Layout

```
apps/api         Express API, Mongoose, Redis
apps/web         storefront (React 18, Vite)
apps/admin       owner dashboard (React 18, Vite)
packages/shared  Zod schemas and helpers shared by every app (money, slots, pincodes, GST)
packages/ui      design tokens, theme, NailArt, shared components and the invoice view
e2e/             Playwright browser tests
docker/          dev image, production Dockerfiles, nginx and Caddy config
```

## Payments (Razorpay, test mode)

Online payment through Razorpay is the only way to pay; there is no cash on delivery. Without Razorpay keys the API still starts, but checkout says online payment is unavailable. To enable it locally:

1. In the Razorpay Dashboard, switch to **Test Mode** and generate API keys (Account & Settings > API Keys).
2. Add to `.env` (never commit it), then `docker compose up -d api` to restart:
   ```sh
   RAZORPAY_KEY_ID=rzp_test_...
   RAZORPAY_KEY_SECRET=...
   RAZORPAY_WEBHOOK_SECRET=...   # any strong random string; you set the same value in step 4
   ```
3. Expose the API so Razorpay can reach the webhook. The compose file has an opt-in Cloudflare quick tunnel (no account needed):
   ```sh
   docker compose --profile tunnel up -d tunnel
   docker compose logs tunnel | grep trycloudflare.com   # your public URL
   ```
   The URL changes every time the tunnel restarts, so update the dashboard webhook when it does. `ngrok http 4000` works too if you have an ngrok account. Stop the tunnel when you are done (`docker compose stop tunnel`); it exposes the whole API.
4. In the Dashboard (Test Mode) > Webhooks, add `https://<your-tunnel-host>/api/webhooks/razorpay` with the secret from step 2 and the events `payment.captured`, `payment.failed` and `order.paid`.
5. Place an order with "Pay online" and use Razorpay's [test cards or test UPI ids](https://razorpay.com/docs/payments/payments/test-card-details/). The order page shows "Payment received" straight away and switches to "Thank you" once the webhook lands.

How it fits together:

- `POST /api/orders` prices the bag on the server, reserves stock in a Mongo transaction and creates the Razorpay order for that exact total. The browser gets only the key id and the Razorpay order id.
- Checkout's success callback is checked at `POST /api/payments/razorpay/verify` (HMAC, timing-safe) so the page can say "payment received", but **only the webhook marks an order paid**.
- The webhook verifies `X-Razorpay-Signature` over the raw body and records `x-razorpay-event-id` in the same transaction as the order change, so replays and concurrent duplicates are no-ops.
- Unpaid orders are cancelled and their stock released after 30 minutes by a BullMQ job. A payment that arrives later is still honoured.
- Without a tunnel, payments still complete in Razorpay but orders stay "waiting for payment" until they expire, because the webhook never arrives.

Customers track orders at `/order/<number>?token=<token>`; the token is in their confirmation link and is stored only as a hash.

## Home-visit bookings

- Availability for a city and day = each active technician's weekly slot times (AvailabilityRule) minus their blocked days (AvailabilityBlock), minus confirmed bookings, minus live holds, limited to technicians who cover that city. Slots must start at least 3 hours ahead and within 90 days. Days and times are India time; everything is stored in UTC.
- The visit length (service plus add-ons) matters, and so does **travel time**: a technician needs at least 1 hour between visits, or 4 hours when one is in Noida and the other in Delhi or Gurgaon (settings in `apps/api/src/config/bookings.ts`).
- Picking a time places a 10-minute hold in Redis. A Lua script checks the technician's other live holds against the same travel-gap rules and claims the time atomically, so clashing holds cannot both succeed. Confirming re-checks inside a Mongo transaction, and a partial unique index on (technician, start) for confirmed and awaiting-payment bookings is the last line of defence. A slot that is gone returns 409.
- A confirmation message is queued on booking; a BullMQ scheduler at 18:00 India time queues reminders for the next day's visits.
- Customers choose to **pay online when booking** (Razorpay, same webhook as orders) or **after the visit** by UPI or cash. An online booking holds its slot as "awaiting payment" until the webhook confirms it; unpaid ones are cancelled after 30 minutes. The customer can retry payment or switch to paying after the visit. A payment that arrives after the slot was given away is recorded and the booking flagged for a refund instead of double-booking.
- `pnpm seed` adds the prototype's services and add-ons and two **placeholder technicians** working every day at 10:00, 12:30, 15:00, 17:30 and 19:30, so the calendar works before the real team is added in the admin.

## Content and SEO

- Stories show only testimonials published in the admin; with none published the section and its nav link are hidden. Promises, FAQ and before/after copy live in `apps/web/src/config/content.ts`, with unconfirmed business statements marked PLACEHOLDER.
- `/robots.txt` and `/sitemap.xml` are served by the API (proxied by the storefront). The sitemap, canonical link and structured data appear only once `PUBLIC_SITE_URL` is set.
- An open set (`/?set=rose-chrome`) gets its own page title and description.

## WhatsApp messages (Meta Cloud API)

Customers get WhatsApp messages only (no email). Meta requires an approved **template** for every message a business starts, so create these five in WhatsApp Manager > Message templates (category **Utility**, language **English**), with exactly this body text:

| Template name        | Body                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `hn_order_placed`    | Hi {{1}}, thank you for your Happy Nails order {{2}} of {{3}}. We will message you when it ships.              |
| `hn_order_shipped`   | Hi {{1}}, your Happy Nails order {{2}} has shipped with {{3}}. Track it here: {{4}}                            |
| `hn_visit_confirmed` | Hi {{1}}, your Happy Nails home visit {{2}} is confirmed for {{3}} in {{4}}. {{5}}                             |
| `hn_visit_reminder`  | Hi {{1}}, a reminder that your Happy Nails home visit is tomorrow, {{2}}. Reply here if you need to change it. |
| `hn_visit_cancelled` | Hi {{1}}, your Happy Nails home visit {{2}} on {{3}} has been cancelled. Message us here to book another time. |

Then set `WHATSAPP_ACCESS_TOKEN` (a permanent System User token) and `WHATSAPP_PHONE_NUMBER_ID` in `.env`. Until then messages are written to the API log with the number masked. The template texts live in `apps/api/src/config/whatsapp.ts`; keep them identical to what Meta approved.

## Shipping (Shiprocket)

1. In Shiprocket, create an API user (Settings > API > Configure) and note the exact name of your pickup address.
2. Set `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD` and `SHIPROCKET_PICKUP_LOCATION` in `.env`. A **Ship with Shiprocket** button then appears on paid orders in the admin: it creates the shipment, assigns a courier, books the pickup and stores the AWB and tracking link.
3. For automatic tracking, add a webhook in Shiprocket (Settings > API > Webhooks) to `https://<your-domain>/api/webhooks/courier-tracking` with a long random token, and set the same token as `SHIPROCKET_WEBHOOK_TOKEN`. Orders then move to shipped (the customer is messaged once) and delivered by themselves.

Parcel size and weight sent to Shiprocket are placeholders in `apps/api/src/shipping/shiprocket.ts`; measure a packed kit and update them.

## GST

- Prices include GST. Each paid order or visit gets one tax invoice; each refund a credit note. Numbers run per financial year (HN/26-27/00001, HNCN/26-27/00001).
- CGST + SGST applies within Uttar Pradesh (orders delivered in UP, visits in Noida); IGST elsewhere (including visits in Delhi and Gurgaon).
- Rate 18%, HSN 3304 (press-on nails), SAC 996812 (delivery), SAC 999722 (manicure services). **Have your CA confirm these**; they are in `packages/shared/src/gst.ts`.
- Customers open their invoice from their order or visit link. The admin GST page shows the month by place of supply and HSN/SAC, with a CSV export for filing.
- After adding invoicing to existing data, run `docker compose exec api pnpm --filter @happynails/api backfill:invoices` once.

## Admin

Open http://localhost:5174 and sign in. `pnpm seed` creates the first owner from `ADMIN_OWNER_EMAIL` and `ADMIN_OWNER_PASSWORD` in `.env` if no owner exists yet.

- **Owner** can do everything, including prices and the catalogue, uploads, refunds, technicians, services and testimonials.
- **Staff** handle day-to-day work: orders and tracking, bookings, and stock counts. There is no screen for adding staff yet; ask for one or create them in the database.
- **Availability**: a month calendar per technician. Set exact start times for any date, close a day, or return it to the weekly pattern; customers see changes immediately.
- Sessions are a 2-hour signed token in an `httpOnly`, `SameSite=Strict` cookie scoped to `/api/admin`, renewed while in use. Passwords are argon2id. Failed sign-ins are limited to 10 per 15 minutes per address.
- Uploads (product photos, testimonial videos and posters) are checked by their actual bytes, limited to 5 MB for images and 50 MB for video, and stored on local disk under `uploads/` in development.

## Testing

- **Unit and API tests** (Vitest, `docker compose exec api pnpm test`): pricing and quotes, stock, Razorpay signatures and webhook idempotency (replays and concurrent duplicates), order expiry, slot generation, travel gaps and holds under concurrency, admin sign-in, sessions and roles, GST splits and invoices, WhatsApp and Shiprocket clients, rate limits and log redaction. API tests use throwaway Mongo databases and Redis key prefixes, never your data.
- **Browser tests** (Playwright, `pnpm e2e` or `docker compose --profile e2e run --rm e2e`): shop to Razorpay payment, booking a visit paid after the visit and paid online, and admin sign-in. They run against the development stack in the Playwright container. With Razorpay test keys they pay with Razorpay's test card and OTP. They create real orders and bookings in the development database and cancel them afterwards through the admin API, using `ADMIN_OWNER_EMAIL` and `ADMIN_OWNER_PASSWORD` from `.env`. A failure leaves a trace and screenshot in `e2e/results` and a report in `e2e/report`. Never point them at production.

## Security

- Prices, totals, stock and slots are decided on the server; the client's numbers are ignored. Orders and visits are only marked paid by a signed Razorpay webhook whose amount matches, recorded once per event id.
- Customer order and visit links carry a random token stored only as a hash and compared in constant time. It is removed from request logs.
- Per-address request limits on the public API: 300 a minute overall; 20 orders, bookings or payment starts and 40 slot holds per 15 minutes; 60 lookups (tracking, invoices, pincode and delivery checks) per 5 minutes. Webhooks are exempt and checked by signature or token instead. The counts live in the API's memory, so they reset on restart and assume one API container.
- Admin: argon2id passwords, short sessions in `httpOnly`, `Secure` (in production), `SameSite=Strict` cookies, a custom header on every request against cross-site forgery, owner-only actions checked on the server, and failed sign-ins limited.
- Production pages send a strict Content-Security-Policy (scripts only from the site and Razorpay, no inline scripts, no eval), `nosniff`, a referrer policy and, through Caddy, HSTS. The admin is also marked `noindex`.
- No secrets reach the browser bundles: only the Razorpay key id is sent to the page, at checkout time.

## Deployment

The production stack is `docker-compose.prod.yml`:

| Service          | What it is                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `edge`           | Caddy: HTTPS for both domains with automatic certificates, HSTS, `www` redirect. The only service with public ports (80, 443).              |
| `web`, `admin`   | nginx serving the built storefront and admin with security headers, forwarding `/api` and `/uploads` to the API.                            |
| `api`            | Node 22 running the bundled API (`docker/api.Dockerfile`), with production dependencies only, as a non-root user. Also runs the job queues. |
| `mongo`, `redis` | Single-node replica set and Redis on the internal network only, with named volumes.                                                         |

Outline:

1. A small Linux VM in India (for example 2 vCPU and 4 GB RAM) with Docker. Point `SITE_DOMAIN` and `ADMIN_DOMAIN` (for example `happynails.in` and `admin.happynails.in`) at it, and open ports 80 and 443 only.
2. Clone the repo and create `.env.production` from `.env.example`: live Razorpay keys and webhook secret, a new `ADMIN_JWT_SECRET`, the owner's email and password, WhatsApp and Shiprocket credentials, and `SITE_DOMAIN`, `ADMIN_DOMAIN` and `ACME_EMAIL`. Keep the file off git (it is ignored).
3. Start: `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`.
4. Seed once: `docker compose -f docker-compose.prod.yml --env-file .env.production exec api node dist/seed.js`. This creates the owner, the catalogue, services and Anamika's hours, without overwriting later edits.
5. In Razorpay (live mode), add the webhook `https://<SITE_DOMAIN>/api/webhooks/razorpay` with the events `payment.captured`, `payment.failed` and `order.paid`. In Shiprocket, add `https://<SITE_DOMAIN>/api/webhooks/courier-tracking` with the token.
6. Sign in to the admin, change the owner password, and place one real low-value order and booking end to end before announcing the site.

Running it:

- **Updates:** `git pull`, then the same `up -d --build` command. Pages are cached by file hash, and `index.html` is never cached, so visitors get the new version straight away.
- **Backups:** at least daily `mongodump` from the `mongo` container to storage off the server, plus the `uploads` volume. Test a restore. Alternatively use MongoDB Atlas (Mumbai region) by setting `MONGO_URL` and removing the `mongo` service.
- **Health:** `https://<SITE_DOMAIN>/api/health` reports Mongo and Redis; point an uptime monitor at it. Logs are JSON on stdout (`docker compose ... logs api`) with request ids, without cookies, tokens or card data.
- **Media:** uploads are stored on the `uploads` volume and served through the site. If traffic grows, move them to S3 or Cloudinary behind the existing `UploadProvider` interface.
- **Behind a CDN** such as Cloudflare in front of Caddy, configure Caddy's `trusted_proxies` so rate limits see the visitor's address rather than the CDN's.
