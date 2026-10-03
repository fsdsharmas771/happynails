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
packages/shared  Zod schemas and helpers shared by every app (money, pincodes)
packages/ui      design tokens and, from phase 2, the theme provider and NailArt
docker/          dev image
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
- The visit length (service plus add-ons) matters: a long visit at 10:00 also blocks a technician's 12:30 start if it runs past 12:30.
- Picking a time places a 10-minute hold in Redis. The hold claims, for one technician, every slot start the visit covers, atomically, so overlapping holds cannot both succeed. Confirming re-checks for overlaps inside a Mongo transaction, and a partial unique index on (technician, start) for confirmed bookings is the last line of defence. A slot that is gone returns 409.
- A confirmation message is queued on booking; a BullMQ scheduler at 18:00 India time queues reminders for the next day's visits.
- Bookings are paid after the visit; there is no online payment for them.
- `pnpm seed` adds the prototype's services and add-ons and two **placeholder technicians** working every day at 10:00, 12:30, 15:00, 17:30 and 19:30, so the calendar works before the real team is added in the admin.

A deployment outline will be added in the hardening phase.
