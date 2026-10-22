# syntax=docker/dockerfile:1.7
#
# Image du moteur du Ludo (services/ludo-ai : @kwatt/ludo-ai derrière un petit
# service HTTP), construite depuis la RACINE du dépôt (monorepo pnpm) :
#
#   docker build -f services/ludo-ai/Dockerfile -t kwatt-ludo-ai .
#
# Le compose de production (deploy/docker-compose.prod.yml) la construit ainsi et
# l'API l'appelle à http://ludo-ai:8090. Aucun secret : seulement NODE_ENV et
# LUDO_AI_PORT (et, au besoin, LUDO_AI_MAX_BUDGET_MS, LUDO_AI_REQUEST_TIMEOUT_MS, LOG_LEVEL).
#
# Étapes : 1) dépendances du service seulement, 2) compilation TypeScript
# (règles, IA, service), 3) `pnpm deploy` : un dossier autonome avec les seules
# dépendances de production, 4) image finale légère, utilisateur non root.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
# pnpm à la version figée dans package.json (champ packageManager).
RUN corepack enable
WORKDIR /repo

# --- 1. Dépendances --------------------------------------------------------------------
FROM base AS deps
COPY . .
RUN --mount=type=cache,id=kwatt-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter kwatt --filter "@kwatt/ludo-ai-service..."

# --- 2. Compilation --------------------------------------------------------------------
FROM deps AS build
RUN pnpm --filter @kwatt/ludo-ai-service run build
RUN --mount=type=cache,id=kwatt-pnpm,target=/pnpm/store \
    pnpm --filter @kwatt/ludo-ai-service deploy --prod --legacy /out

# --- 3. Image finale -------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG KWATT_VERSION=dev
ENV NODE_ENV=production \
    KWATT_VERSION=${KWATT_VERSION} \
    HOST=0.0.0.0 \
    LUDO_AI_PORT=8090
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.LUDO_AI_PORT||8090)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
