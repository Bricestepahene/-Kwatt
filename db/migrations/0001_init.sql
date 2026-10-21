-- Kwatt · schéma initial (V1)
-- Correspond à la section 4 de docs/proposition-v1.md.
-- La base stocke et contrôle l'intégrité ; elle ne décide jamais d'un coup ni d'un dé.

CREATE EXTENSION IF NOT EXISTS citext;

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

-- Contrôles du grand livre ---------------------------------------------------

-- Chaque transaction est équilibrée : la somme de ses écritures vaut 0.
CREATE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COALESCE(SUM(amount), 0) FROM ledger_entries WHERE tx_id = NEW.tx_id) <> 0 THEN
    RAISE EXCEPTION 'transaction % non équilibrée', NEW.tx_id;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER ledger_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

-- Le journal est immuable.
CREATE FUNCTION ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'le journal des cauris ne se modifie pas';
END $$;

CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER ledger_transactions_immutable BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

-- Index de lecture -----------------------------------------------------------
CREATE INDEX ledger_entries_wallet ON ledger_entries (wallet_id);
CREATE INDEX ledger_transactions_game ON ledger_transactions (game_id);
CREATE INDEX game_players_user ON game_players (user_id);
CREATE INDEX games_room ON games (room_id);
CREATE INDEX room_members_user ON room_members (user_id);

-- Comptes système du grand livre.
INSERT INTO wallets (kind, system_code) VALUES
  ('system', 'welcome'),
  ('system', 'rewards'),
  ('system', 'house'),
  ('system', 'shop');

ALTER TABLE rating_history ADD FOREIGN KEY (game_id) REFERENCES games(id);
