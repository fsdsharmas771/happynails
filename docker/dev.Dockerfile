# Dev image shared by the install, api, web and admin services.
# The repo is bind-mounted at /app; node_modules live in named volumes.
FROM node:22-alpine

# corepack verifies pnpm's signature against keys it ships with; older bundled
# keys reject newer pnpm releases, so skip the check for this dev-only image.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_INTEGRITY_KEYS=0 \
    PNPM_HOME=/pnpm \
    npm_config_store_dir=/app/node_modules/.pnpm-store \
    npm_config_update_notifier=false
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.34.6 --activate

WORKDIR /app
