# Production image for the storefront (APP=web) or the admin (APP=admin):
# a Vite build served by nginx, which also forwards /api to the API container.
FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_INTEGRITY_KEYS=0 \
    npm_config_update_notifier=false
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /repo
ARG APP
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@happynails/${APP}..." --filter happynails
COPY packages packages
COPY apps/${APP} apps/${APP}
# Public address for canonical links and structured data (storefront only; optional).
ARG PUBLIC_SITE_URL=""
ENV PUBLIC_SITE_URL=${PUBLIC_SITE_URL}
RUN pnpm --filter "@happynails/${APP}" build

FROM nginx:1.29-alpine
ARG APP
COPY docker/nginx/security-${APP}.conf /etc/nginx/snippets/security.conf
COPY docker/nginx/${APP}.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/${APP}/dist /usr/share/nginx/html
