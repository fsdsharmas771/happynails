# Production API image: a bundled build plus production dependencies only.
# Built by docker-compose.prod.yml from the repository root.
FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_INTEGRITY_KEYS=0 \
    npm_config_update_notifier=false
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @happynails/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @happynails/api build \
 && pnpm --filter @happynails/api deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production \
    UPLOAD_DIR=/app/uploads
WORKDIR /app
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/index.js"]
