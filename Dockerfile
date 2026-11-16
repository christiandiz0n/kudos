# syntax=docker/dockerfile:1
# Vouch api (apps/api) for Railway (D-305). Build context = repo root.
# Only the PRODUCTION deps of @vouch/api and its workspace deps (@vouch/shared) are installed. `--prod` matters: the
# root package.json has only devDependencies (forge-std from GitHub, @openzeppelin/contracts, typescript), and a
# filtered install still installs the root importer, so without --prod it would fetch forge-std from codeload.github.com.
# No native compiles (esbuild/pglite ship prebuilt binaries/WASM). The api runs TypeScript directly with tsx, which is a
# runtime dependency of @vouch/api (D-202/D-204); there is no build step.
# Secrets (STREAMS_WEBHOOK_SECRET, later relayer keys) come from Railway service variables at runtime, never from files:
# .dockerignore excludes every .env* file.
FROM node:24-slim

ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true

# pnpm pinned to the root package.json `packageManager`.
RUN corepack enable pnpm \
 && corepack prepare pnpm@11.28.6 --activate \
 && chmod -R a+rX /opt/corepack \
 && pnpm --version

WORKDIR /app

# 1) Manifests only, so the dependency layer is cached until a manifest or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

# Filtered, production-only, lockfile-exact install of @vouch/api + its workspace deps.
RUN pnpm install --frozen-lockfile --prod --filter "@vouch/api..."

# 2) Sources.
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/

# Writable dir for the optional NDJSON spike log / PGlite fallback (ephemeral; Postgres is the record on Railway).
RUN mkdir -p /app/data/local && chown -R node:node /app/data

ENV NODE_ENV=production \
    API_HOST=0.0.0.0
USER node
WORKDIR /app/apps/api
EXPOSE 8080

# Listens on $PORT (Railway) → API_PORT → 4000 (apps/api/src/env.ts). Migrations run on boot (db.migrate()).
# Plain node + the tsx loader: one process, so SIGTERM reaches server.ts's graceful shutdown.
CMD ["node", "--import", "tsx", "src/server.ts"]
