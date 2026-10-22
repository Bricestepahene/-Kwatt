# syntax=docker/dockerfile:1.7
#
# Image du serveur Kwatt (@kwatt/server : API REST + temps réel), construite depuis la
# RACINE du dépôt (monorepo pnpm) :
#
#   docker build -f apps/server/Dockerfile -t kwatt-api --build-arg KWATT_VERSION=$(git rev-parse --short HEAD) .
#
# Étapes : 1) dépendances du serveur seulement (pas celles de l'appli mobile),
#          2) compilation TypeScript (serveur + @kwatt/protocol + @kwatt/design),
#          3) `pnpm deploy` : un dossier autonome avec les seules dépendances de production,
#          4) image finale légère, utilisateur non root.
#
# Dans l'image :
#   node dist/main.js               démarre le serveur (commande par défaut)
#   node dist/db/migrate-cli.js     applique les migrations (db/migrations copié dans l'image)
#   node dist/admin/cli.js …        petite CLI d'administration

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
# Racine (TypeScript) + serveur et ses paquets internes, rien d'autre.
RUN --mount=type=cache,id=kwatt-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter kwatt --filter "@kwatt/server..."

# --- 2. Compilation --------------------------------------------------------------------
FROM deps AS build
RUN pnpm --filter @kwatt/server run build
# Dossier autonome : dist/ + package.json + node_modules de production (paquets internes copiés).
RUN --mount=type=cache,id=kwatt-pnpm,target=/pnpm/store \
    pnpm --filter @kwatt/server deploy --prod --legacy /out \
 && cp -r db/migrations /out/migrations

# --- 3. Image finale -------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG KWATT_VERSION=dev
ENV NODE_ENV=production \
    KWATT_VERSION=${KWATT_VERSION} \
    HOST=0.0.0.0 \
    API_PORT=8080 \
    MIGRATIONS_DIR=/app/migrations \
    MEDIA_DIR=/data/media
WORKDIR /app
COPY --from=build --chown=node:node /out /app
# Dossier des médias : un volume Docker y est monté (photos de profil…).
RUN mkdir -p /data/media && chown -R node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||8080)+'/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
