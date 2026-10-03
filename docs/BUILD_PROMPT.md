# Happy Nails: master build prompt for Claude Code

Paste everything below the line into Claude Code, run from the repo root. Start in plan mode so it proposes the plan before writing files.

---

You are building the production website for **Happy Nails by Anamika** in this repository.

## 0. The business

- Sells press-on nail extension sets online, delivered across India.
- Offers at-home nail services (offline visits) in **Delhi, Noida and Gurgaon only**.
- The owner must be able to manage **products, orders and bookings** from an admin panel.
- Payments for online orders go through **Razorpay**. Home-visit bookings are paid after the service (no online payment in v1). Cash on delivery is also offered for orders.

## 1. Source of truth for the design

`docs/design-reference.html` is a single-file working prototype of the storefront. Read it fully before planning. Reproduce its look and behaviour exactly in React:

- **Two themes, one toggle.** Light = "Atelier Ivory", dark = "Noir Rosé". Port every CSS variable from `:root`, the dark blocks and `[data-theme]` selectors. Theme follows `prefers-color-scheme` until the user toggles, then persists in `localStorage` (wrapped in try/catch). The display font changes per theme (Bodoni Moda in light, Cormorant Garamond in dark, Manrope for body). Keep the cursor effect (gold ring in light, rose-gold spotlight in dark).
- **Nail art is drawn, not photographed.** Port the `nailSet()` SVG generator (shapes: almond, coffin, square, oval, stiletto; finishes: gloss, matte, ombre, chrome, cateye, french, glitter, art) into a typed `<NailArt />` React component in `packages/ui`. Product records store `shape`, `finish`, `color`, `color2`; if a product also has uploaded photos, show photos first and keep `<NailArt />` as the fallback and for thumbnails.
- **Sections and flows to port:** hero with the self-drawing brush ring, marquee, collection with shape and occasion filters, product drawer, bag drawer with free-delivery progress bar, size finder, 4-step booking stepper with month calendar and slots, video stories with lightbox, before/after slider, promises, FAQ, footer, mobile bottom bar, 3-step checkout overlay, order confirmation with tracking timeline.
- **Motion:** page-load line reveal, ring draw, floating nails, scroll slide-up (transform only, content always visible at rest), magnetic buttons, hide-on-scroll-down nav, scroll progress bar. Respect `prefers-reduced-motion`.
- **No stock icon sets.** Do not add lucide, heroicons, font-awesome or similar. Use drawn CSS/SVG shapes as in the reference.
- **Accessibility:** focus-visible rings, focus moved into dialogs and restored on close, Escape closes overlays, `aria-live` regions for slots and toasts, labelled form fields with inline errors. Responsive from 360px up with no horizontal page scroll.
- Everything in the reference marked as sample or placeholder (testimonials, prices, contact details, slot availability, policies) must come from the database or config in the real app. Never ship fake reviews as genuine. Testimonials render only if an admin has added a real one.

## 2. Stack and repository

Monorepo with **pnpm workspaces** (Turborepo optional). TypeScript strict everywhere.

```
apps/
  web/      storefront: React 18, Vite, React Router, TanStack Query
  admin/    owner dashboard: React, Vite, same UI package
  api/      Node 22, Express, Zod, Mongoose, pino
packages/
  shared/   zod schemas, inferred types, money/slot/pincode helpers (used by web, admin, api)
  ui/       design tokens (CSS variables), theme provider, NailArt, shared components
docs/design-reference.html
docker-compose.yml  docker-compose.prod.yml  .env.example  CLAUDE.md
```

- Styling: plain CSS modules or a single tokens stylesheet in `packages/ui`. No Tailwind, no component library, so the design stays exact.
- State: TanStack Query for server data, a small `zustand` store for cart and UI state. Cart persists to `localStorage`, but prices are always re-quoted by the server.
- Lint and format: ESLint + Prettier, `tsc --noEmit` in CI. Vitest for unit and API tests, Playwright for a few end-to-end flows at the end.

## 3. Docker (everything runs in containers on this machine)

Provide `docker-compose.yml` for development with these services:

- `mongo`: `mongo:7`, **single-node replica set `rs0`** (transactions are required), healthcheck that initiates the set, named volume.
- `redis`: `redis:7-alpine`, named volume.
- `api`, `web`, `admin`: `node:22-alpine`, bind-mount the repo, shared `node_modules` named volume, `corepack enable`, run `pnpm install` then the package's dev script, hot reload working, ports 4000 / 5173 / 5174. `api` depends on healthy `mongo` and started `redis`.
- Use the service names in connection strings: `mongodb://mongo:27017/happynails?replicaSet=rs0`, `redis://redis:6379`.
- Add scripts at root: `pnpm up`, `pnpm down`, `pnpm seed` (runs inside the api container), `pnpm test`.
- Also write `docker-compose.prod.yml` with multi-stage production Dockerfiles for each app (api as a Node image, web and admin built to static files served by nginx). Do not run production compose locally unless asked.
- `.env.example` documents every variable. Never commit `.env`.

## 4. Data model (MongoDB, Mongoose, money stored as integer paise)

- **Product:** `slug` (unique), `name`, `description`, `shape`, `finish`, `occasion` (everyday | party | bridal), `color`, `color2?`, `pricePaise`, `stock`, `images[]` (url + alt), `active`, `sortOrder`, timestamps.
- **Order:** `number` (human readable, e.g. HN260001), `customer{name,phone,email}`, `address{line,pincode,city,state}`, `items[{productId, name, optionKey, unitPaise, qty}]` (price snapshots), `subtotalPaise`, `shippingPaise`, `codFeePaise`, `totalPaise`, `shippingSpeed` (standard | express), `paymentMethod` (razorpay | cod), `payment{razorpayOrderId, razorpayPaymentId, status, paidAt}`, `status` (pending_payment | placed | packed | shipped | delivered | cancelled | refunded), `tracking{carrier,awb,url}`, `trackToken`, `events[]` (status history), timestamps.
- **Service:** `name`, `description`, `minutes`, `pricePaise`, `active`. **Addon:** same plus per-hand or flat note.
- **Technician:** `name`, `phone`, `cities[]`, `active`, `photo?`.
- **AvailabilityRule:** `technicianId`, `weekday`, `slotTimes[]` (e.g. 10:00, 12:30, 15:00, 17:30, 19:30), `validFrom?`, `validTo?`. **AvailabilityBlock:** `technicianId`, `date` or range, `reason`.
- **Booking:** `number` (HN-V...), `customer`, `city`, `pincode`, `address`, `serviceId`, `addonIds[]`, `totalPaise`, `minutes`, `technicianId`, `startsAt`, `endsAt`, `status` (confirmed | completed | cancelled | no_show), `notes`, `events[]`. **Partial unique index** on `(technicianId, startsAt)` where status is `confirmed`, so double booking is impossible at the database level.
- **Testimonial:** `name`, `city`, `setName`, `quote`, `videoUrl`, `posterUrl`, `published`, `sortOrder`.
- **AdminUser:** `email`, `passwordHash` (argon2), `role` (owner | staff), `lastLoginAt`.
- **Customer** is optional in v1 (guest checkout). Store orders and bookings with embedded customer details.

## 5. API (REST, JSON, validated with the Zod schemas in `packages/shared`)

Public:

- `GET /api/products`, `GET /api/products/:slug`
- `POST /api/shipping/eta` (pincode to estimate, same rules as the prototype: NCR 1 to 2 days, others longer)
- `POST /api/checkout/quote` (cart in, server-calculated totals out: subtotal, shipping with free threshold, express fee, COD fee)
- `POST /api/orders` (creates the order, reserves stock; for Razorpay also creates the Razorpay order and returns what Checkout needs)
- `POST /api/payments/razorpay/verify` (client callback verification)
- `POST /api/webhooks/razorpay` (source of truth for payment state)
- `GET /api/orders/track?number=&token=` (guest tracking)
- `GET /api/services`
- `GET /api/availability?city=&serviceId=&month=YYYY-MM` (per-day open slot counts and per-slot detail)
- `POST /api/bookings/hold` (puts a 10-minute hold on a slot in Redis)
- `POST /api/bookings` (confirms; needs a valid hold)
- `POST /api/pincode/check` (Delhi 110xxx, Noida 201301 to 201310, Gurgaon 122xxx, returns city or not-covered)
- `GET /api/testimonials`

Admin (cookie auth, role-checked), all under `/api/admin`:

- `auth/login`, `auth/logout`, `auth/me`
- Products CRUD, image upload endpoint, reorder, activate or deactivate, stock adjust
- Orders: list with filters and search, detail, change status (with allowed transitions), add tracking, cancel, **refund via Razorpay API**
- Bookings: list by day, week or month and by city or technician, create manually, reschedule, cancel, complete
- Technicians CRUD, availability rules and blocks CRUD
- Services and add-ons CRUD
- Testimonials CRUD with video and poster upload
- Dashboard summary (today's visits, orders to pack, revenue this month)

## 6. Razorpay integration (follow Razorpay's official docs for the current API; verify field names against them)

Use the official `razorpay` Node SDK in the API only.

1. **Create order (server).** In `POST /api/orders` with `paymentMethod: razorpay`, recompute totals server-side, create the local order as `pending_payment`, then `razorpay.orders.create({ amount: totalPaise, currency: "INR", receipt: order.number, notes: { orderId } })`. Store `razorpayOrderId`. Return `{ orderNumber, razorpayOrderId, amount, keyId }`. `RAZORPAY_KEY_SECRET` never leaves the server.
2. **Open Checkout (web).** Load Razorpay's `checkout.js` on demand and open it with `key`, `order_id`, `amount`, prefill name, phone and email, and a theme colour taken from the active theme's accent. Card, UPI and netbanking details are entered inside Razorpay's own window, never in our inputs. Remove the card or UPI fields from our UI; keep the payment method choice of Razorpay vs COD.
3. **Client callback.** On success the handler returns `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature`. Send them to `/api/payments/razorpay/verify`. The server verifies the HMAC SHA256 of `order_id|payment_id` with the key secret using a timing-safe compare. A valid signature lets the UI show "payment received", but it does **not** by itself finalise the order.
4. **Webhook is the source of truth.** `POST /api/webhooks/razorpay` uses the **raw request body** (mount `express.raw` on this route before any JSON parser), verifies `X-Razorpay-Signature` with `RAZORPAY_WEBHOOK_SECRET`, and handles `payment.captured`, `payment.failed` and `order.paid`. Make it **idempotent** using the event id header stored in a `processedWebhooks` collection with a unique index. Marking an order `placed`, deducting final stock, and enqueueing notifications all happen here, inside a Mongo transaction.
5. **Failure and expiry.** Stock is reserved when the order is created. A BullMQ delayed job releases the reservation and cancels the order if still `pending_payment` after 30 minutes. A failed payment lets the customer retry against the same order.
6. **Refunds.** Admin refund calls the Razorpay refund API for the captured payment, records the refund id and amount, and moves the order to `refunded` (or partial note).
7. **Test mode first.** Use `rzp_test_` keys locally. Document how to expose the webhook locally (ngrok or Cloudflare Tunnel) in the README. Never log secrets or full payloads containing personal data.
8. **COD.** Creates the order directly as `placed` with the COD fee; no Razorpay call.

## 7. Booking engine rules

- Open slots for a day = technician availability rules for that weekday, minus availability blocks, minus confirmed bookings, minus active Redis holds, limited to technicians covering the chosen city.
- A slot is bookable only if it starts at least **3 hours from now** and within **90 days**. Times are handled in `Asia/Kolkata`; store UTC.
- Service duration plus add-on minutes decides the booking length; a technician cannot take overlapping bookings.
- `POST /api/bookings/hold` sets a Redis key with a 10-minute TTL and returns a hold token. `POST /api/bookings` consumes it, assigns the first free technician, writes the booking in a transaction, and relies on the unique index as the last line of defence. Return a clear 409 when the slot is gone.
- The calendar in the UI shows per-day state: open, few left (2 or fewer, gold dot), unavailable (struck out). Switching city refetches.
- No online payment for bookings in v1. Show "Pay after your visit by UPI or cash".

## 8. Notifications and background jobs

- BullMQ on Redis. Queues: `notifications`, `maintenance`.
- Define a `Notifier` interface with `sendWhatsApp` and `sendEmail`. In development, log the message instead of sending. Implement real providers behind env flags later. Triggers: order placed, order shipped (with tracking), booking confirmed, booking reminder the evening before (cron), booking cancelled.

## 9. Security and quality

- `helmet`, strict CORS to the web and admin origins, `express-rate-limit` (tighter on login, holds and orders), request size limits, Zod validation on every input, central error handler returning stable error codes.
- Admin auth: argon2 password hashes, short-lived JWT in an `httpOnly`, `Secure`, `SameSite=Strict` cookie, role checks on every admin route, seed script creates the first owner from env vars.
- Prices, totals, stock and slot availability are always decided on the server.
- Never store or log card data. Never put secrets in the frontend bundles.
- Structured logs with `pino`, request ids, and a `/api/health` endpoint that checks Mongo and Redis.
- Image uploads: validate type and size, store via an `UploadProvider` interface (local disk volume in dev, S3 or Cloudinary in prod).
- Add a `README.md` with setup, commands, env variables, Razorpay test steps, and a deployment outline.

## 10. Build in these phases. Stop after each phase, summarise, run the checks, and wait for my approval.

1. **Foundation:** monorepo, shared and ui packages, Docker dev stack, health endpoint, all three apps boot with hot reload. *Done when `docker compose up` shows web, admin and api running and `/api/health` reports Mongo and Redis ok.*
2. **Design system and storefront shell:** tokens, theme toggle, NailArt, nav, hero, marquee, footer, mobile bar. *Done when light and dark both match the reference visually at 390px and 1280px.*
3. **Catalogue:** Product model, seed data from the prototype's ten sets, products API, collection page with filters, product drawer, size finder.
4. **Cart and checkout with Razorpay:** quote endpoint, bag drawer, checkout overlay, Razorpay order and verify, webhook, COD, confirmation and tracking page. *Done when a test-mode payment completes end to end and a replayed webhook changes nothing.*
5. **Bookings:** services, technicians, availability, calendar, holds, confirmation, pincode check.
6. **Admin app:** auth, dashboard, products, orders (status, tracking, refund), bookings calendar, technicians and availability, testimonials, services.
7. **Content and polish:** stories with real video upload, before/after, FAQ, SEO tags, sitemap, performance pass (code splitting, image sizes), accessibility pass.
8. **Tests and hardening:** unit and API tests for pricing, slots, webhook idempotency, auth; Playwright for browse to pay, and book a visit; security review; production compose.

## Working agreement

- Show a short plan for the current phase first. Ask me only about real blockers; otherwise choose a sensible default and note it.
- Small, reviewable commits with clear messages. Do not commit `.env` or secrets.
- Run lint, type checks and tests before saying a phase is done, and report anything you could not verify.
- Do not invent business facts. Anything I have not given you (prices, policies, contact details, courier choice, GST details) goes in a config file or the database with a clearly marked placeholder, and you list those placeholders at the end of each phase.
- Begin with phase 1 now.
