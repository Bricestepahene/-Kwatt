# Kwatt

**Le quartier joue ici.** Hub de jeux mobile, sur Android et iPhone : Dames 10×10 et 8×8, Ludo, puis Raisonnement plus tard. Un seul profil pour tous les jeux, sans publicité, avec des cauris qui ne s'achètent pas et ne se retirent pas.

- Maquette : canevas « Kwatt — hub de jeux » (planche « 00 · Sommaire » et planches « Réf »)
- Proposition d'architecture, plan et modèle de données : [`docs/proposition-v1.md`](docs/proposition-v1.md)

## Organisation du dépôt

| Dossier | Contenu | État |
|---|---|---|
| `packages/design` | Jetons de design : couleurs, polices, tissus, ergonomie | ✅ |
| `packages/rules-dames` | Règles exactes des dames 10×10 internationales et 8×8 anglaises | ✅ testé |
| `packages/rules-ludo` | Règles du Ludo : croix (2 à 4 joueurs), étoile (5 et 6), classique, rapide, équipes | ✅ testé |
| `packages/fair-dice` | Dé vérifiable : engagement, puis révélation du secret | ✅ testé |
| `db/migrations` | Schéma PostgreSQL | ✅ |
| `apps/mobile` | Appli Expo (React Native) | à venir |
| `apps/server` | API et serveur de parties temps réel | à venir |
| `services/ludo-ai` | Moteur stratégique du Ludo (service séparé) | à venir |
| `research/ludo` | Simulation et entraînement en Python | à venir |

## Démarrer

Prérequis : Node 22, pnpm 10, Docker (ou un PostgreSQL 16 local).

```sh
cp .env.example .env          # puis remplir les secrets
pnpm install
pnpm typecheck
pnpm test
docker compose up -d          # PostgreSQL 16 (pas de Redis en V1, D-02)
pnpm db:migrate               # applique les migrations (db/migrations, table schema_migrations)
pnpm --filter @kwatt/server dev
```

Mise en production sur un VPS : [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md).

## Principes

- **Le serveur fait foi** pour chaque coup, chaque mise et chaque lancer de dé.
- **La machine ne touche jamais au dé** : elle gagne par la qualité de ses décisions.
- **Pas d'argent réel** : les cauris se gagnent seulement en jouant.
