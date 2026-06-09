##############################################################################
# CRM Platform — API Dockerfile
# Multi-stage build: compiles TypeScript → lean production image
# Works for both cloud (AWS/GCP/Azure) and on-prem deployments.
##############################################################################

# ── Stage 1: install deps ──────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Copy all workspace manifests first (layer-cache friendly)
COPY package.json turbo.json ./
COPY packages/shared/package.json     ./packages/shared/
COPY packages/core/package.json       ./packages/core/
COPY packages/api/package.json        ./packages/api/
COPY modules/contacts/package.json    ./modules/contacts/
COPY modules/deals/package.json       ./modules/deals/
COPY modules/activities/package.json  ./modules/activities/
COPY modules/analytics/package.json   ./modules/analytics/
COPY modules/billing/package.json     ./modules/billing/
COPY modules/connectors/package.json  ./modules/connectors/
COPY modules/voice/package.json       ./modules/voice/
COPY modules/crm/package.json         ./modules/crm/
COPY modules/voice-module/package.json ./modules/voice-module/
COPY modules/ticketing/package.json   ./modules/ticketing/

RUN npm install --workspaces --include-workspace-root

# ── Stage 2: build (TypeScript → JavaScript) ──────────────────────────────
FROM deps AS builder
WORKDIR /app

COPY packages/shared  ./packages/shared
COPY packages/core    ./packages/core
COPY packages/api     ./packages/api
COPY modules          ./modules

# Build in dependency order
RUN npm run build --workspace=packages/shared && \
    npm run build --workspace=packages/core   && \
    npm run build --workspace=packages/api

# ── Stage 3: lean runtime image ───────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# tini: proper PID 1 for signal handling (graceful shutdown)
RUN apk add --no-cache tini wget
ENTRYPOINT ["/sbin/tini", "--"]

ENV NODE_ENV=production

# Copy compiled output + migrations only (no source files)
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/core/dist   ./packages/core/dist
COPY --from=builder /app/packages/api/dist    ./packages/api/dist

# Copy migrations (needed by db:migrate script)
COPY --from=builder /app/packages/core/src/database/migrations \
                    ./packages/core/src/database/migrations

# Copy node_modules and root package.json
COPY --from=builder /app/node_modules  ./node_modules
COPY --from=builder /app/package.json  ./

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Run migrations then start server
CMD ["sh", "-c", "node packages/api/dist/scripts/migrate.js && node packages/api/dist/server.js"]
