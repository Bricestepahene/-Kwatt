# Kwatt · consignes pour Claude Code

Hub de jeux mobile (Dames, Ludo, plus tard Raisonnement), en français et en anglais. La référence fonctionnelle est la maquette « Kwatt — hub de jeux » ; l'architecture et le plan sont dans `docs/proposition-v1.md`. En cas de doute sur une règle, la maquette (planches « Réf ») fait foi, puis les décisions consignées dans ce document. Une règle absente des deux se demande, elle ne s'invente pas.

## Pile
- TypeScript partout (Node 22, pnpm workspaces), modules ES, `strict` et `noUncheckedIndexedAccess`.
- Appli : Expo / React Native, plateaux en `react-native-skia`.
- Serveur : Fastify + WebSocket ; PostgreSQL 16 ; Redis pour la présence et le pub/sub.
- Moteur Ludo : service séparé (`services/ludo-ai`) ; Python seulement dans `research/` (entraînement, évaluation).
- Hébergement : un VPS, avec `docker compose`.

## Commandes
- `pnpm install`
- `pnpm typecheck` : `tsc -b` sur tous les paquets
- `pnpm test` : vitest
- Migrations : `db/migrations/*.sql`, appliquées dans l'ordre (voir `.github/workflows/ci.yml`)

## Règles intangibles
- **Le serveur fait foi** : le client propose, `@kwatt/rules-*` valide côté serveur à partir de l'état serveur. On écrit en base avant de diffuser.
- Les paquets `rules-*` et `fair-dice` restent **purs et déterministes** : pas d'I/O, pas d'horloge, pas de `Math.random`.
- **Le dé ne dépend de rien** d'autre que le secret de la partie, le numéro du lancer et le grain de sel du joueur. Aucun moteur d'IA n'importe `fair-dice` côté serveur.
- **Cauris** : uniquement par le grand livre en partie double (`ledger_transactions` + `ledger_entries`), avec une clé d'idempotence. Jamais d'`UPDATE` direct d'un solde hors transaction de journal. Pas d'argent réel, pas de publicité.
- Mises : 18 ans et plus, profils seulement. Plafond = min(25 % du plus petit solde, limite de la table). Jamais deux comptes du même appareil l'un contre l'autre.
- Les règles maison rendent une partie **amicale** : pas de classement, pas de mise, pas de ligue publique.

## Design (ne pas improviser)
- Couleurs : uniquement depuis `@kwatt/design`, sans couleur écrite en dur dans les écrans. Fond `#0F1230`, surfaces `#20265A`, bordures `#3D4590`, en-têtes et badges ndop `#1D2B6E`, texte `#F4EEDF`, texte secondaire `#A9AECF`. L'or `#F2B705` est réservé à « agis maintenant » et « à toi » ; alertes en corail `#FF8A75`.
- Polices : Unbounded (titres, scores, chiffres), DM Sans (texte).
- Tissus (ndop, toghu, kaba, obom) dessinés en code, jamais en images.
- Zones tactiles ≥ 48 px, cases de damier ≥ 34 px, toucher le pion puis la case, contraste 4,5:1, pions du Ludo doublés d'une forme.

## Décisions déjà prises (V1)
Voir la section « Décisions » de `docs/proposition-v1.md`.

## Conventions
- Code et identifiants en anglais ; textes visibles, commentaires et messages de commit en français.
- Tout nouveau comportement de règle s'accompagne d'un test.
- Ne jamais versionner `.env` : seulement `.env.example`.
