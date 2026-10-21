# Kwatt — proposition d'architecture, plan par étapes, modèle de données

Sources : maquette Kwatt (canevas « Kwatt — hub de jeux »), planches « 00 · Sommaire », « Réf · Identité & design system », « Réf · Données, cauris, comptes », « Réf · Ligue publique », « Réf · Matrice complète », « Réf · Moteur de jeu (IA) », « Réf · Variantes du Ludo », « Réf · Compétitions », « Réf · Tailles d'écran », « Réf · Audit UX », ainsi que les écrans 02, 15, 16, 18, 20b, 21, 22, 23, 24, 25 et 26.

Document de travail : **aucun code n'est écrit avant validation des questions de la section 6.**

---

## 1. Architecture

### 1.1 Vue d'ensemble

```
┌──────────────────────────── Appli mobile (Expo / React Native, TypeScript) ───────────────────────────┐
│  Écrans (Sommaire 01→43)   Plateaux (react-native-skia)   Tissus en code   Unbounded + DM Sans        │
│  @kwatt/rules-*  ← mêmes règles que le serveur : affichage des coups légaux, jeu hors ligne vs machine │
└────────────┬───────────────────────────────────────────────┬──────────────────────────────────────────┘
             │ HTTPS (REST : comptes, profil, cauris, salons) │ WebSocket (temps réel : salon, partie)
┌────────────▼───────────────────────────────────────────────▼──────────────────────────────────────────┐
│  API (Fastify)                         │  Serveur de parties (un acteur par salon / partie)            │
│  auth, profil, journal des cauris      │  valide chaque coup, tire chaque dé, tient les pendules,      │
│                                        │  bloque/verse les mises, écrit chaque coup avant de diffuser  │
└───────┬───────────────────┬────────────┴──────────────┬───────────────────────────┬───────────────────┘
        │                   │                           │ requête « choisis un coup »│
┌───────▼──────┐   ┌────────▼────────┐       ┌──────────▼──────────┐    ┌───────────▼───────────┐
│ PostgreSQL   │   │ Redis           │       │ Moteur Dames        │    │ Moteur Ludo (service  │
│ fait foi     │   │ présence, pub/  │       │ (worker threads TS) │    │ séparé, TypeScript)   │
│ (comptes,    │   │ sub entre       │       └─────────────────────┘    └───────────▲───────────┘
│ coups, dés,  │   │ nœuds, routage  │                                               │ politiques exportées
│ cauris)      │   │ code → nœud     │                                   ┌───────────┴───────────┐
└──────────────┘   └─────────────────┘                                   │ research/ (Python)    │
                                                                         │ simulation, auto-jeu, │
                                                                         │ évaluation (hors prod)│
                                                                         └───────────────────────┘
```

### 1.2 Dépôt (monorepo pnpm + Turborepo)

| Dossier | Rôle |
|---|---|
| `apps/mobile` | Appli unique Android + iOS : **Expo (React Native) + TypeScript**, Hermes, `react-native-skia` pour les plateaux et les motifs de tissu (ndop, toghu, kaba, obom) dessinés en code, jamais en images. Objectif < 40 Mo installé. |
| `apps/server` | Node.js + Fastify (REST) + `ws` (WebSocket). Un seul binaire, deux rôles (API, parties) activables séparément pour monter en charge. |
| `services/ludo-ai` | Moteur stratégique du Ludo, **processus séparé** (HTTP interne ou gRPC). Il reçoit un état + la liste des coups légaux, renvoie un coup + son explication. Il ne voit jamais le générateur de dés. |
| `packages/rules-dames` | Règles exactes 10×10 (prise majoritaire, dame volante, rafle retirée en fin de coup, nulles) puis 8×8. Pur, déterministe, sans I/O. |
| `packages/rules-ludo` | Deux couches, comme la planche « Variantes » : **forme du plateau** (croix 4, étoile 6, croix 68 cases…) × **mécanismes** (sortie, capture, protection, barrières, lancer, victoire, équipes). Chaque variante = un préréglage ; les combinaisons interdites de la planche sont refusées par le type et par la validation. |
| `packages/engine-dames` | Alpha-bêta, approfondissement itératif, table de transposition, prises jamais coupées. Tourne dans des worker threads côté serveur ; version légère dans l'appli pour le hors-ligne. |
| `packages/protocol` | Messages client ↔ serveur décrits en `zod` (validation des deux côtés, types partagés). |
| `packages/fair-dice` | Tirage vérifiable (voir 1.5) + vérificateur réutilisé par l'écran 22. |
| `packages/design` | Jetons de design (couleurs, polices, rayons, tailles) — source unique pour l'appli. |
| `research/ludo` | Python : simulateur vectorisé, agents, auto-jeu, banc d'essai. Hors production. |
| `db/` | Migrations SQL (outil : `node-pg-migrate` ou Drizzle Kit), données de test. |

### 1.3 Le serveur fait foi

- Le client **propose**, le serveur **décide** : chaque intention (`move`, `roll`, `resign`, `offerDraw`…) est validée par `rules-*` côté serveur à partir de l'état serveur, jamais de l'état envoyé par le client.
- Ordre fixe pour chaque coup : valider → écrire en base (coup + dé + état condensé, dans une transaction) → diffuser. Si l'écriture échoue, rien n'est diffusé.
- Chaque message porte un numéro de demi-coup (`ply`) : un message en retard ou rejoué est ignoré (idempotence).
- Un acteur par partie (une file d'événements, un seul écrivain) : pas de course entre deux coups simultanés.
- Pendules tenues par le serveur (Fischer : ex. 5 min + 3 s). L'appli affiche une estimation corrigée par la latence.
- Coupure : place gardée 60 s, pendule arrêtée (règle « Partie coupée »). Reconnexion = l'appli redemande l'état complet au dernier `ply`.
- Redémarrage d'un nœud : la partie est reconstruite en rejouant les coups enregistrés (moteur déterministe).
- Mises : les cauris sont **bloqués** sur un compte séquestre de la partie avant le premier coup ; versement ou remboursement dans la même transaction que le résultat.

### 1.4 Temps réel des salons

- WebSocket unique par appli connectée, canaux `room:{code}` et `game:{id}`.
- Redis : présence, pub/sub entre nœuds, table `code → nœud` pour router le salon vers l'acteur qui le tient.
- V1 : un seul nœud suffit ; le routage est prévu pour passer à plusieurs nœuds sans changer le protocole.
- États de la matrice gérés dès la V1 : « On cherche le salon… », salon plein → « regarder à la place », hôte parti → le plus ancien devient hôte, place gardée 60 s.

### 1.5 Dé honnête et vérifiable (écran 22)

Protocole engagement / révélation, indépendant de tout moteur stratégique :

1. Avant la partie : le serveur tire `server_seed` (32 octets, `crypto.randomBytes`, jamais `random()` de PostgreSQL) et publie `commitment = SHA-256(server_seed)` à tous les joueurs.
2. À chaque lancer : le joueur qui touche le dé envoie un `client_seed` (son « grain de sel »). Valeur = `HMAC-SHA256(server_seed, game_id ‖ roll_index ‖ client_seed)`, convertie en 1–6 par **rejet** (pas de modulo biaisé).
3. Fin de partie : `server_seed` est révélé ; l'écran 22 (et n'importe qui) recalcule tous les lancers.
4. Le moteur Ludo et le module de dés ne partagent aucun code ni aucun état ; aucune donnée de joueur (niveau, solde, série de défaites) n'entre dans le calcul.
5. Tests statistiques automatiques (χ², séries) sur de grands échantillons, en complément — pas en remplacement — de la conception et de l'audit.

Le lancer de cauris du Pachisi utilisera le même tirage (6 bits indépendants) plus tard.

### 1.6 Comptes

- E-mail ou téléphone + mot de passe (argon2id), Google, Apple (obligatoire sur iOS dès qu'on propose Google).
- Mot de passe oublié : code à 6 chiffres, 10 min, 5 essais (stocké haché).
- Jeton d'accès court (15 min) + jeton de renouvellement tournant, lié à l'appareil.
- **Invité** : jeton temporaire lié à l'appareil, sans mise, peut rejoindre un salon par code et une ligue privée gratuite. À la création du profil, ses parties sont rattachées.
- Année de naissance : < 13 ans pas de compte, 13–17 compte jeune (pas de mise contre un joueur), 18+ compte complet.
- Pseudo unique, changeable une fois tous les 30 jours ; suppression sous 30 jours avec export.

### 1.7 Design (repris tel quel des planches)

| Jeton | Valeur | Usage |
|---|---|---|
| Nuit | `#0F1230` | fond |
| Surface | `#20265A` | cartes (valeur post-audit, voir question 8) |
| Bordure | `#3D4590` | lignes, contours |
| Ndop | `#1D2B6E` | en-têtes, badges |
| Raphia | `#F4EEDF` | texte |
| Texte secondaire | `#A9AECF` | |
| Or toghu | `#F2B705` | **uniquement** « agis maintenant » et « à toi » |
| Corail | `#FF8A75` | alertes, pertes |
| Vert gain | `#5FD3A2` (texte) / `#1F9D6B` (aplat) | gains |
| Rouge toghu | `#E0442E` | Ludo |
| Bleu Wouri | `#3FA7E0` | Ludo |
| Damier | `#F1E2BF` / `#A8703F` | cases claires / foncées (contraste 4,5:1 corrigé) |
| Obom | `#6E4426` | bois |

Polices : **Unbounded** 500/700/800 (titres, scores, chiffres), **DM Sans** 400/500/700 (texte, formulaires).
Règles : zones tactiles ≥ 48 px, cases ≥ 34 px, toucher le pion puis la case (jamais de glisser obligatoire), pions du Ludo doublés d'une forme (rond, carré, losange, gélule), contraste 4,5:1, taille de police du système respectée, mode Plein soleil, français et anglais. Barre du bas : Accueil · Jouer (dernier espace utilisé) · Ligues · Cartes · Profil, cachée en partie. Sons : balafon (déplacer), tam-tam (prise), nkul (ton tour), mvet (victoire, dame).

---

## 2. Moteur stratégique du Ludo

### 2.1 Principe
La machine ne touche jamais au dé. Elle reçoit `état + valeur du dé + coups légaux` (calculés par `rules-ludo`) et choisit. La difficulté vient **uniquement** de la qualité des décisions : budget de calcul, profondeur, politique utilisée.

### 2.2 Interface commune
```ts
interface LudoAgent {
  id: string;            // ex. "heuristic@1.2.0"
  choose(input: { state: LudoState; roll: number; legal: LudoMove[]; budgetMs: number }):
    { move: LudoMove; candidates: { move: LudoMove; score: number; pCapture?: number; pSafe?: number; ev?: number }[]; stats: { nodes?: number; sims?: number; depth?: number; elapsedMs: number } };
}
```
Chaque décision est enregistrée (`ai_decisions`) : on peut toujours répondre à « pourquoi ce coup plutôt qu'un autre ? ».

### 2.3 Progression des agents (chacun doit battre le précédent pour être retenu)
1. **Aléatoire légal** — référence basse.
2. **Heuristique** explicable : progression, sortie, capture, mise à l'abri, distance aux menaces (probabilité exacte d'être pris au prochain tour de chaque adversaire, calculée sur les 6 faces et les relances sur 6), entrée dans le couloir final, blocage.
3. **Expectimax à profondeur réduite** : nœuds de hasard pour le dé (1/6 chacun), nœuds de décision pour chaque joueur. À plus de 2 joueurs ce n'est pas un minimax : on compare l'hypothèse *max-n* (chacun maximise son score) et l'hypothèse *paranoïaque* (tous contre la machine), et on garde la meilleure mesurée.
4. **MCTS** (UCT avec nœuds de hasard, simulations guidées par l'heuristique) sous budget de temps fixe.
5. **Évaluation apprise par auto-jeu** (Python) : réseau ou table de valeurs entraîné, exporté en ONNX et exécuté par `onnxruntime-node` dans `services/ludo-ai`, utilisé comme fonction d'évaluation pour (3) ou (4).

Les échelons (Apprenti → Fon) correspondent à des agents et budgets différents, pas à un dé différent.

### 2.4 Python sans dupliquer les règles à l'aveugle
- `research/ludo` réimplémente le simulateur pour la vitesse (NumPy), **mais** chaque version doit passer des **fixtures d'or** générées par `rules-ludo` (état + dé → coups légaux → état suivant). Une divergence = échec du CI.
- Rust seulement si les simulations deviennent le goulot, mesuré.

### 2.5 Mesurer la force réelle
- Matchs de milliers de parties, places de départ tournées, **mêmes suites de dés pour les agents comparés** (nombres aléatoires communs : réduit fortement la variance).
- Acceptation d'une nouvelle version par test séquentiel (SPRT) contre la précédente ; intervalle de confiance affiché ; aucune régression acceptée.
- Adversaires variés : aléatoire, heuristique, versions passées, styles « agressif » et « prudent ».
- Côté joueurs : force façon Elo par variante classée, ajustée sur plusieurs parties ; objectif 45–55 % de victoires à son niveau (planche Moteur).

---

## 3. Plan par étapes

### Étape 0 — Socle (≈ 1 semaine)
Monorepo, CI (lint, types, tests), PostgreSQL + migrations, jetons de design, polices, navigation et barre du bas, écrans vides aux noms de route du Sommaire.

### Étape 1 — Règles exactes, sans interface (≈ 2 semaines)
- `rules-dames` 10×10 complet, nulles « même position 3 fois » et « 25 coups de dames sans prise ni pion joué » ; notation 1–50. Tests : positions de référence (rafles, prise majoritaire, dame volante, promotion en fin de rafle).
- `rules-ludo` classique (et plateau 6 branches si confirmé, question 1) : sortie au 6, 6 rejoue, trois 6 le tour passe, étoiles et départs protégés, chiffre exact pour rentrer, places 1er → dernier.
- Rejeu déterministe : même état initial + mêmes dés = même partie.

### Étape 2 — Compte, profil, invité (≈ 2 semaines)
Écrans 01–06, 07 (accueil réduit), 09 (profil), 13 (paramètres essentiels). Invité par code, rattachement des parties à la création du profil, contrôle de l'âge.

### Étape 3 — Dames 10×10 contre la machine (≈ 2 semaines)
Écrans 14, 16, 18, 19 (revoir). `engine-dames` alpha-bêta, échelons par profondeur et bruit contrôlé. Jouable hors connexion ; gains envoyés au retour du réseau et **revalidés par le serveur en rejouant la partie**.

### Étape 4 — Serveur temps réel + salons Dames (≈ 2–3 semaines)
Écrans 02, 24, 25, 16, 18. Code à 6 caractères, formats partie simple / aller-retour / roi de la table, file d'attente, pendule Fischer, proposer la nulle, abandon, reconnexion 60 s.

### Étape 5 — Ludo en salon (≈ 2–3 semaines)
Écrans 20, 20b (préréglage Classique), 21 (et 21b si 6 joueurs), 22, 23. Dé vérifiable, temps par tour, coup unique joué automatiquement, **agent heuristique** pour remplacer un joueur absent (règle à trancher, question 3).

### Étape 6 — Cauris et journal (≈ 1–2 semaines, en parallèle de 4–5)
Grand livre en partie double, bonus de bienvenue 500, participation +10, victoire contre la machine +25 sans pari, 10 parties récompensées par jour, journal lisible dans le profil, mises de salon si retenues (question 2). Aucune publicité, aucun achat de cauris.

**→ V1 jouable** : bêta fermée (TestFlight + test interne Play).

### Après la V1 (ordre proposé)
Ludo contre la machine (heuristique puis expectimax/MCTS), recherche Python et auto-jeu, Dames 8×8, défi et pari contre la machine (cote = 0,9 ÷ p), amis et notifications, ligues privées puis publiques, Plein soleil, spectateurs, cartes et médailles, variantes Rapide / Parchís / Pachisi, Raisonnement, tablette.

---

## 4. Modèle de données (PostgreSQL)

Correspondance avec la planche « Réf · Données, cauris, comptes » :

| Planche | Tables |
|---|---|
| Profil | `users`, `auth_identities`, `profiles`, `devices` |
| NiveauJeu | `player_ratings`, `rating_history` (= *player_skill*) |
| Salon | `rooms`, `room_members` |
| Partie | `games`, `game_players`, `moves`, `game_snapshots`, `dice_rolls` |
| Mouvement | `wallets`, `ledger_transactions`, `ledger_entries` |
| Objet, Médaille, Ligue | prévus après la V1 (`items`, `owned_items`, `medals`, `leagues`…) |
| IA | `ai_models`, `ai_decisions`, `training_runs`, `evaluation_matches` |

La base stocke et contrôle l'intégrité ; elle ne décide **jamais** d'un coup ni d'un dé.

```sql
-- Types
CREATE TYPE game_family  AS ENUM ('dames','ludo','raisonnement');
CREATE TYPE game_variant AS ENUM ('dames10','dames8','ludo_classique','ludo_rapide','ludo_parchis','ludo_pachisi','ludo_six');
CREATE TYPE user_kind    AS ENUM ('guest','member');

-- Comptes ------------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          user_kind NOT NULL,
  birth_year    smallint,                      -- jamais affichée
  locale        text NOT NULL DEFAULT 'fr',
  merged_into   uuid REFERENCES users(id),     -- invité rattaché à un profil
  created_at    timestamptz NOT NULL DEFAULT now(),
  delete_requested_at timestamptz,             -- effacement sous 30 jours
  CHECK (kind = 'guest' OR birth_year IS NOT NULL)
);

CREATE TABLE auth_identities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  provider      text NOT NULL CHECK (provider IN ('email','phone','google','apple')),
  subject       text NOT NULL,                 -- e-mail normalisé, E.164, ou sub OIDC
  password_hash text,                          -- argon2id (email/phone)
  verified_at   timestamptz,
  UNIQUE (provider, subject)
);

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES auth_identities(id),
  purpose     text NOT NULL CHECK (purpose IN ('verify','reset')),
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,            -- +10 min
  attempts    smallint NOT NULL DEFAULT 0 CHECK (attempts <= 5),
  used_at     timestamptz
);

CREATE TABLE devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  install_id   text NOT NULL UNIQUE,           -- identifiant d'installation
  platform     text NOT NULL CHECK (platform IN ('android','ios')),
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_devices (                    -- sert à interdire les mises entre comptes du même appareil
  user_id   uuid REFERENCES users(id),
  device_id uuid REFERENCES devices(id),
  PRIMARY KEY (user_id, device_id)
);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  device_id   uuid NOT NULL REFERENCES devices(id),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid REFERENCES refresh_tokens(id)
);

CREATE TABLE profiles (
  user_id           uuid PRIMARY KEY REFERENCES users(id),
  pseudo            citext NOT NULL UNIQUE,
  pseudo_changed_at timestamptz,               -- une fois / 30 jours
  avatar_item_id    uuid,                      -- FK vers items (après V1)
  frame_item_id     uuid,
  photo_url         text,
  photo_status      text CHECK (photo_status IN ('pending','approved','rejected')),
  quarter           text,                      -- quartier (Guerre des quartiers, plus tard)
  settings          jsonb NOT NULL DEFAULT '{}' -- sons, vibration, numéros des cases, animation du dé…
);
-- Les invités ont aussi un nom de partie : stocké dans game_players.display_name.

-- Niveau par jeu (NiveauJeu / player_skill) ---------------------------------
CREATE TABLE player_ratings (
  user_id      uuid REFERENCES users(id),
  variant      game_variant,                   -- une force par variante classée
  rating       integer NOT NULL DEFAULT 1000,
  games_played integer NOT NULL DEFAULT 0,
  level        smallint NOT NULL DEFAULT 1,
  echelon      text NOT NULL DEFAULT 'apprenti', -- apprenti, debrouillard, ancien, notable, chef, fon
  win_streak   smallint NOT NULL DEFAULT 0,
  loss_streak  smallint NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, variant)
);
CREATE TABLE rating_history (
  user_id  uuid, variant game_variant,
  game_id  uuid NOT NULL,
  before   integer NOT NULL, after integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, variant, game_id)
);

-- Salons --------------------------------------------------------------------
CREATE TABLE rooms (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           char(6) NOT NULL,             -- affiché « M4T-K9Q »
  variant        game_variant NOT NULL,
  rules          jsonb NOT NULL,               -- préréglage + règles maison (⇒ amical)
  seats          smallint NOT NULL CHECK (seats BETWEEN 2 AND 6),
  format         text NOT NULL CHECK (format IN ('simple','aller_retour','roi')),
  clock_base_ms  integer, clock_inc_ms integer, turn_ms integer,
  stake          integer NOT NULL DEFAULT 0 CHECK (stake >= 0), -- 0 = amical
  ranked         boolean NOT NULL,
  host_user_id   uuid NOT NULL REFERENCES users(id),
  status         text NOT NULL CHECK (status IN ('open','playing','closed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz
);
CREATE UNIQUE INDEX rooms_code_active ON rooms(code) WHERE status <> 'closed';

CREATE TABLE room_members (
  room_id    uuid REFERENCES rooms(id),
  user_id    uuid REFERENCES users(id),
  role       text NOT NULL CHECK (role IN ('seat','queue','spectator')),
  seat_index smallint,
  queue_pos  smallint,
  staking    boolean NOT NULL DEFAULT false,   -- toujours false pour un invité
  joined_at  timestamptz NOT NULL DEFAULT now(),
  left_at    timestamptz,
  PRIMARY KEY (room_id, user_id)
);

-- Parties -------------------------------------------------------------------
CREATE TABLE games (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context          text NOT NULL CHECK (context IN ('machine','room','league')),
  room_id          uuid REFERENCES rooms(id),
  variant          game_variant NOT NULL,
  rules            jsonb NOT NULL,
  rules_version    text NOT NULL,              -- version de @kwatt/rules-* (rejeu exact)
  ranked           boolean NOT NULL,
  stake_per_player integer NOT NULL DEFAULT 0,
  status           text NOT NULL CHECK (status IN ('waiting','playing','finished','aborted')),
  end_reason       text,                       -- normal, resign, timeout, absence, draw_repetition, draw_25, draw_agreement…
  rng_commitment   bytea,                      -- SHA-256(server_seed), publié avant la partie
  rng_server_seed  bytea,                      -- révélé à la fin, NULL pendant la partie
  started_at       timestamptz, ended_at timestamptz
);

CREATE TABLE game_players (
  game_id      uuid REFERENCES games(id),
  seat         smallint,
  user_id      uuid REFERENCES users(id),      -- NULL si machine
  ai_model_id  uuid,                           -- renseigné si machine (ou remplaçant)
  display_name text NOT NULL,
  color        text NOT NULL,
  team         smallint,
  place        smallint,                       -- 1 = gagnant ; Dames : 1/2, nul = place NULL + result
  result       text CHECK (result IN ('win','loss','draw','abandon')),
  PRIMARY KEY (game_id, seat)
);

CREATE TABLE dice_rolls (
  game_id     uuid REFERENCES games(id),
  roll_index  integer,
  seat        smallint NOT NULL,
  client_seed bytea NOT NULL,                  -- grain de sel du joueur (ou de la machine)
  value       smallint NOT NULL CHECK (value BETWEEN 1 AND 6),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, roll_index)
);

CREATE TABLE moves (                            -- journal append-only, source de vérité du rejeu
  game_id      uuid REFERENCES games(id),
  ply          integer,
  turn_no      integer NOT NULL,               -- tour (Ludo : un tour = un ou plusieurs lancers)
  seat         smallint NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('move','pass','resign','draw_offer','draw_accept','timeout','bot_takeover')),
  roll_index   integer,                        -- Ludo : lancer utilisé
  payload      jsonb NOT NULL,                 -- Dames : chemin + pions pris ; Ludo : pion, de, vers, capture
  clock_ms     integer,                        -- temps restant après le coup
  played_by    text NOT NULL CHECK (played_by IN ('human','ai','auto')), -- auto = coup unique joué seul
  state_hash   bytea NOT NULL,                 -- contrôle du rejeu
  server_ts    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, ply),
  FOREIGN KEY (game_id, roll_index) REFERENCES dice_rolls(game_id, roll_index)
);

CREATE TABLE game_snapshots (                   -- = game_states : points de reprise rapides
  game_id uuid REFERENCES games(id),
  ply     integer,
  state   jsonb NOT NULL,
  PRIMARY KEY (game_id, ply)
);

-- Cauris : grand livre en partie double (Mouvement) --------------------------
CREATE TABLE wallets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('player','escrow','system')),
  user_id     uuid UNIQUE REFERENCES users(id),        -- kind = player
  game_id     uuid UNIQUE REFERENCES games(id),        -- kind = escrow (mises bloquées)
  system_code text UNIQUE,                             -- welcome, rewards, house, shop…
  balance     bigint NOT NULL DEFAULT 0,
  CHECK (kind <> 'player' OR balance >= 0),
  CHECK (kind <> 'escrow' OR balance >= 0)
);

CREATE TABLE ledger_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL,  -- welcome_bonus, participation, machine_win, stake_lock, stake_payout, stake_refund, purchase…
  game_id         uuid REFERENCES games(id),
  idempotency_key text NOT NULL UNIQUE,       -- ex. 'payout:<game_id>' : jamais deux versements
  memo            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (                  -- immuable : ni UPDATE ni DELETE (révoqués par droits)
  tx_id     uuid REFERENCES ledger_transactions(id),
  wallet_id uuid REFERENCES wallets(id),
  amount    bigint NOT NULL CHECK (amount <> 0),       -- + crédit, − débit
  balance_after bigint NOT NULL,
  PRIMARY KEY (tx_id, wallet_id)
);
-- Trigger de contrainte différé : somme(amount) par tx_id = 0.
-- wallets.balance mis à jour dans la même transaction (SELECT … FOR UPDATE), CHECK ≥ 0 empêche le découvert.

CREATE TABLE daily_rewards (                   -- 10 parties récompensées / jour contre la machine
  user_id uuid REFERENCES users(id),
  day     date,
  family  game_family,
  count   smallint NOT NULL DEFAULT 0 CHECK (count <= 10),
  PRIMARY KEY (user_id, day, family)
);

-- IA ------------------------------------------------------------------------
CREATE TABLE ai_models (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant     game_variant NOT NULL,
  name        text NOT NULL,                   -- ex. 'ludo-heuristic'
  version     text NOT NULL,
  algorithm   text NOT NULL CHECK (algorithm IN ('random','heuristic','expectimax','mcts','learned','alphabeta')),
  params      jsonb NOT NULL,                  -- poids, budget, profondeur…
  artifact_uri text, artifact_sha256 bytea,    -- fichier ONNX / poids
  status      text NOT NULL CHECK (status IN ('candidate','active','retired')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

CREATE TABLE ai_decisions (
  game_id    uuid,
  ply        integer,
  model_id   uuid NOT NULL REFERENCES ai_models(id),
  roll_value smallint,
  chosen     jsonb NOT NULL,
  candidates jsonb NOT NULL,                   -- [{move, score, pCapture, pSafe, ev}]
  stats      jsonb NOT NULL,                   -- nœuds, simulations, profondeur
  elapsed_ms integer NOT NULL,
  PRIMARY KEY (game_id, ply),
  FOREIGN KEY (game_id, ply) REFERENCES moves(game_id, ply)
);

CREATE TABLE training_runs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id   uuid REFERENCES ai_models(id),   -- modèle produit
  config     jsonb NOT NULL,
  opponents  jsonb NOT NULL,
  metrics    jsonb,
  started_at timestamptz NOT NULL, ended_at timestamptz
);

CREATE TABLE evaluation_matches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_a     uuid NOT NULL REFERENCES ai_models(id),
  model_b     uuid NOT NULL REFERENCES ai_models(id),
  games       integer NOT NULL,
  dice_seed   bytea NOT NULL,                  -- mêmes suites de dés pour A et B
  a_win_rate  numeric(5,4) NOT NULL,
  ci_low      numeric(5,4), ci_high numeric(5,4),
  elo_diff    numeric(7,2),
  verdict     text CHECK (verdict IN ('accept','reject','inconclusive')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

Remarques :
- `moves` + `dice_rolls` + `rules_version` suffisent à rejouer toute partie ; `game_snapshots` sert seulement à reprendre vite.
- La table *turns* demandée est représentée par `moves.turn_no` (un tour de Ludo = un lancer, éventuellement relancé sur un 6). On peut l'extraire en vue SQL si besoin.
- `moves` et `ledger_entries` seront partitionnées par mois quand le volume l'exigera.

---

## 5. Incohérences relevées dans les planches

1. **Ludo 2 à 6** : la planche Variantes et l'écran 24 réservent 5–6 joueurs au plateau **étoile à 6 branches** (classement séparé) ; le Classique est sur la croix, 2 à 4. La planche Données indique aussi « places 2 à 4 ».
2. **Temps par tour au Ludo** : écran 25 « 30 s par coup » ; planche Compétitions « 15 s par tour, après 3 tours manqués la machine joue à ta place ».
3. **Absence** : planche Données « absence de plus de 60 s : défaite » ; planche Compétitions « la machine joue à ta place » (Ludo). À plusieurs, une « défaite » d'un joueur doit être précisée (il sort ? la machine continue ?).
4. **Niveaux de la machine aux Dames** : 6 échelons (Apprenti → Fon) dans Moteur/Échelons, 5 difficultés (Facile → Fon) à l'écran 15, « 5 niveaux » dans la matrice.
5. **Couleur des surfaces** : planche Identité « Ndop #1D2B6E · surfaces », Sommaire et Audit « surfaces #20265A, bordures #3D4590 ».
6. **Nulles en 10×10** : seuils de fin de partie « à valider avec la fédération » (planche Compétitions).

---

## 6. Questions avant de coder

1. **Ludo de 2 à 6 en V1** : croix pour 2 à 4 + étoile à 6 branches pour 5–6 (comme les planches), ou seulement la croix 2–4 en V1 ?
2. **Mises en V1** : mise en salon (18 ans et plus, plafond = min(25 % du plus petit solde, limite de la table)) dès la V1, ou seulement les cauris gagnés (bienvenue, participation, victoires contre la machine) et leur journal ?
3. **Joueur absent au Ludo** : 15 s par tour et, après 3 tours manqués, la machine joue à sa place jusqu'à la fin (sans mise récupérable) ; ou bien 30 s et sortie de la partie après 60 s ?
4. **Machine aux Dames** : les 6 échelons (Apprenti → Fon) de la planche Moteur, ou les 5 difficultés de l'écran 15 ? Et le jeu hors connexion contre la machine dès la V1 ?
5. **Connexion en V1** : e-mail + téléphone (SMS au Cameroun : fournisseur à choisir), Google, Apple — tout dès la V1 ou l'e-mail d'abord ?
6. **Hébergement** : préférence de fournisseur et de région (proche de Douala/Yaoundé pour la latence), budget ?
7. **Langues** : français et anglais dès la V1 ?
8. **Couleur des surfaces** : `#20265A` (post-audit) partout, `#1D2B6E` réservé aux en-têtes et badges ?
9. **Sortie** : Android et iOS ensemble pour la V1, ou Android d'abord ?
