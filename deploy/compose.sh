#!/bin/sh
# Raccourci pour docker compose en production, utilisable depuis n'importe quel dossier :
#
#   ./deploy/compose.sh up -d --build        construire et (re)démarrer
#   ./deploy/compose.sh ps                   état des services
#   ./deploy/compose.sh logs -f api          journaux de l'API
#   ./deploy/compose.sh exec api node dist/admin/cli.js stats
#
# Il passe le fichier .env de la racine du dépôt (variables du compose) et le fichier
# deploy/docker-compose.prod.yml. Toute la documentation : docs/DEPLOIEMENT.md.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ ! -f "$ROOT/.env" ]; then
  echo "Fichier $ROOT/.env introuvable : copier .env.example en .env et le remplir (docs/DEPLOIEMENT.md)." >&2
  exit 1
fi

# Version affichée par /v1/health : le commit courant, sauf si KWATT_VERSION est déjà posée.
if [ -z "${KWATT_VERSION:-}" ] && command -v git >/dev/null 2>&1; then
  KWATT_VERSION=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo dev)
  export KWATT_VERSION
fi

exec docker compose --env-file "$ROOT/.env" -f "$ROOT/deploy/docker-compose.prod.yml" "$@"
