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

Razorpay test steps and a deployment outline will be added in the phases that introduce them.
