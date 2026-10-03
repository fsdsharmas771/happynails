# Happy Nails

Storefront and back office for Happy Nails by Anamika: press-on nail sets shipped across India, and at-home nail services in Delhi, Noida and Gurgaon only.

## Source of truth

- Visual design and behaviour: `docs/design-reference.html`. Match it, light and dark themes both.
- Build plan and phases: `docs/BUILD_PROMPT.md`. Work one phase at a time and wait for approval.

## Stack

pnpm monorepo, TypeScript strict. `apps/web` and `apps/admin` (React 18, Vite), `apps/api` (Node 22, Express 5, Zod 4, Mongoose 8, pino), `packages/shared` (Zod schemas and helpers), `packages/ui` (tokens, theme, NailArt). MongoDB 7 as a single-node replica set `rs0`, Redis 7, BullMQ.

Workspace packages export TypeScript source directly (no build step); Vite and `tsx` compile them.

## Run everything in Docker

- `docker compose up` starts mongo, redis, a one-shot `install`, then api, web, admin. Do not run services directly on the host.
- Run commands inside containers, for example `docker compose exec api pnpm test`, `docker compose exec api pnpm lint`, `docker compose exec api pnpm typecheck`. The api container has the whole repo mounted, so root scripts work from there.
- After changing dependencies: `docker compose run --rm install`, then restart the affected service.
- Ports: api 4000, web 5173, admin 5174, mongo 27017, redis 6379.
- `pnpm up` is pnpm's alias for `update`; use `pnpm run up` for the compose script.

## Rules

- Money is integer paise. Prices, totals, stock and slot availability are decided on the server only.
- Razorpay: create orders server-side, verify signatures with a timing-safe compare, treat the verified webhook (raw body, idempotent by event id) as the source of truth. Never handle card data or expose `RAZORPAY_KEY_SECRET`.
- Double booking is prevented by a partial unique index plus Redis holds. Times are Asia/Kolkata in the UI, UTC in storage.
- No icon libraries, no Tailwind, no component library. Draw shapes with CSS and SVG as in the reference.
- Never commit `.env`. Update `.env.example` whenever a variable is added.
- Do not invent business facts. Use clearly marked placeholders and list them.

## Before saying a task is done

Run lint, `tsc --noEmit` and tests inside the containers, and report anything not verified.
