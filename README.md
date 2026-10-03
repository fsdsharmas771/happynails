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

Without Razorpay keys the API starts normally and offers **cash on delivery only**. To enable online payment locally:

1. In the Razorpay Dashboard, switch to **Test Mode** and generate API keys (Account & Settings > API Keys).
2. Add to `.env` (never commit it), then `docker compose up -d api` to restart:
   ```sh
   RAZORPAY_KEY_ID=rzp_test_...
   RAZORPAY_KEY_SECRET=...
   RAZORPAY_WEBHOOK_SECRET=...   # any strong random string; you set the same value in step 4
   ```
3. Expose the API so Razorpay can reach the webhook. Either tool works:
   ```sh
   cloudflared tunnel --url http://localhost:4000
   # or
   ngrok http 4000
   ```
4. In the Dashboard (Test Mode) > Webhooks, add `https://<your-tunnel-host>/api/webhooks/razorpay` with the secret from step 2 and the events `payment.captured`, `payment.failed` and `order.paid`.
5. Place an order with "Pay online" and use Razorpay's [test cards or test UPI ids](https://razorpay.com/docs/payments/payments/test-card-details/). The order page shows "Payment received" straight away and switches to "Thank you" once the webhook lands.

How it fits together:

- `POST /api/orders` prices the bag on the server, reserves stock in a Mongo transaction and creates the Razorpay order for that exact total. The browser gets only the key id and the Razorpay order id.
- Checkout's success callback is checked at `POST /api/payments/razorpay/verify` (HMAC, timing-safe) so the page can say "payment received", but **only the webhook marks an order paid**.
- The webhook verifies `X-Razorpay-Signature` over the raw body and records `x-razorpay-event-id` in the same transaction as the order change, so replays and concurrent duplicates are no-ops.
- Unpaid orders are cancelled and their stock released after 30 minutes by a BullMQ job. A payment that arrives later is still honoured.
- Without a tunnel, payments still complete in Razorpay but orders stay "waiting for payment" until they expire, because the webhook never arrives.

Customers track orders at `/order/<number>?token=<token>`; the token is in their confirmation link and is stored only as a hash.

A deployment outline will be added in the hardening phase.
