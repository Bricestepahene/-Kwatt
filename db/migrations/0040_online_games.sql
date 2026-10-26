-- Kwatt · parties en ligne (contrat C3) : salons, défis avec mise, spectateurs et pronostics,
-- dé vérifiable, revue anti-triche. Plage 0040–0049.

-- Parties : secret du dé gardé jusqu'à la fin (jamais envoyé), parties listées dans /regarder.
ALTER TABLE games
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN rng_secret bytea,                      -- copié dans rng_server_seed à la fin
  ADD COLUMN listed boolean NOT NULL DEFAULT true;  -- visible dans « Autour du damier »
CREATE INDEX games_live_idx ON games (status) WHERE status IN ('waiting', 'playing');
CREATE INDEX games_room_idx ON games (room_id) WHERE room_id IS NOT NULL;

-- Joueurs d'une partie : mise bloquée (profil de 18 ans et plus), sortie du Ludo.
ALTER TABLE game_players
  ADD COLUMN staking boolean NOT NULL DEFAULT false,
  ADD COLUMN out_at timestamptz;
CREATE INDEX game_players_user_idx ON game_players (user_id) WHERE user_id IS NOT NULL;

-- Salons : nom, partie en cours, aller-retour, roi de la table, fermeture après 30 min.
ALTER TABLE rooms
  ADD COLUMN name text NOT NULL DEFAULT '',
  ADD COLUMN game_id uuid REFERENCES games(id),
  ADD COLUMN last_game_id uuid REFERENCES games(id),
  ADD COLUMN leg smallint CHECK (leg IN (1, 2)),
  ADD COLUMN king_user_id uuid REFERENCES users(id),
  ADD COLUMN king_wins smallint NOT NULL DEFAULT 0,
  ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN listed boolean NOT NULL DEFAULT true;  -- false : salon d'un défi entre deux joueurs
CREATE INDEX rooms_open_idx ON rooms (status, last_activity_at) WHERE status <> 'closed';

ALTER TABLE room_members
  ADD COLUMN ready boolean NOT NULL DEFAULT false,
  ADD COLUMN kept_until timestamptz;                -- place gardée 60 s après un départ

-- Défis avec mise (écran 26) : expirent 2 h après la dernière proposition.
CREATE TABLE challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id  uuid NOT NULL REFERENCES users(id),
  to_user_id    uuid NOT NULL REFERENCES users(id),
  variant       game_variant NOT NULL,
  format        text NOT NULL CHECK (format IN ('simple', 'aller_retour')),
  clock_base_ms integer,
  clock_inc_ms  integer,
  stake         integer NOT NULL CHECK (stake >= 0),
  awaiting      uuid REFERENCES users(id),          -- qui doit répondre à la dernière proposition
  countered     boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  rematch_of    uuid REFERENCES games(id),
  room_id       uuid REFERENCES rooms(id),
  game_id       uuid REFERENCES games(id),
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (from_user_id <> to_user_id)
);
CREATE INDEX challenges_to_idx ON challenges (to_user_id, status);
CREATE INDEX challenges_from_idx ON challenges (from_user_id, status);
CREATE INDEX challenges_pending_idx ON challenges (expires_at) WHERE status = 'pending';

-- Pronostics des spectateurs (écran 37, D-09) : 50 cauris en pari mutuel.
CREATE TABLE predictions (
  game_id    uuid NOT NULL REFERENCES games(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  seat       smallint NOT NULL,
  stake      integer NOT NULL CHECK (stake > 0),
  payout     integer,                                -- rempli au règlement
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id)
);

-- Réactions des spectateurs, montrées aux joueurs à la fin seulement.
CREATE TABLE game_reactions (
  game_id    uuid NOT NULL REFERENCES games(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  key        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX game_reactions_game_idx ON game_reactions (game_id);

-- Revue anti-triche : jamais de sanction automatique, un modérateur regarde.
CREATE TABLE moderation_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     uuid REFERENCES games(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  kind        text NOT NULL,                         -- engine_agreement, report…
  details     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  decision    text
);
CREATE UNIQUE INDEX moderation_flags_game_user_kind ON moderation_flags (game_id, user_id, kind) WHERE game_id IS NOT NULL;

-- Lancer de cauris (Pachisi) : `value` garde le nombre d'ouvertures vers le ciel (0 à 6).
ALTER TABLE dice_rolls DROP CONSTRAINT dice_rolls_value_check;
ALTER TABLE dice_rolls ADD CONSTRAINT dice_rolls_value_check CHECK (value BETWEEN 0 AND 6);
