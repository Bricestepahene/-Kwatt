-- Kwatt · progression : guerre des quartiers, séries de jours, quêtes de la semaine,
-- habillages équipés, liste d'attente du Raisonnement (écrans 36, 39, 40, 42). Plage 0070–0079.

-- Points de quartier : une ligne par partie classée gagnée (idempotent par partie et joueur).
-- Le quartier est celui du gagnant au moment de la partie ; la saison est le mois civil (Cameroun).
CREATE TABLE quarter_points (
  game_id    uuid NOT NULL REFERENCES games(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  quarter_id text NOT NULL REFERENCES quarters(id),
  season     char(7) NOT NULL,                     -- AAAA-MM
  points     smallint NOT NULL CHECK (points > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id)
);
CREATE INDEX quarter_points_season_idx ON quarter_points (season, quarter_id);
CREATE INDEX quarter_points_user_idx ON quarter_points (user_id, season);

-- Saisons closes et quartier champion (son cadre de profil va à tous ses joueurs).
CREATE TABLE quarter_seasons (
  season      char(7) PRIMARY KEY,
  champion_id text REFERENCES quarters(id),
  closed_at   timestamptz NOT NULL DEFAULT now()
);

-- Photo du classement prise au début de chaque jour : tendance ▲ ▼ depuis ce matin.
CREATE TABLE quarter_rank_snapshots (
  day      char(10) NOT NULL,                      -- AAAA-MM-JJ (heure du Cameroun)
  scope    text NOT NULL CHECK (scope IN ('quarter', 'city', 'country')),
  key      text NOT NULL,                          -- id du quartier, « CM:Douala », « CM »
  position integer NOT NULL,
  points   integer NOT NULL,
  PRIMARY KEY (day, scope, key)
);

-- Série de jours au kwatt : un jour compte dès une partie terminée ou un problème du jour tenté.
CREATE TABLE day_streaks (
  user_id      uuid PRIMARY KEY REFERENCES users(id),
  last_day     integer NOT NULL,                   -- numéro de jour (@kwatt/domain dayNumber)
  length       integer NOT NULL CHECK (length > 0),
  best         integer NOT NULL DEFAULT 0,
  -- Cartes rares au choix gagnées (7e jour, 14e…) et pas encore choisies.
  rare_choices integer NOT NULL DEFAULT 0 CHECK (rare_choices >= 0)
);

-- Événements de quête (une ligne par partie et joueur, ou par problème résolu) : l'avancement
-- se recalcule à partir d'eux (@kwatt/domain questProgress) pour la semaine ISO.
CREATE TABLE quest_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  week       char(8) NOT NULL,                     -- AAAA-Wnn
  source     text NOT NULL,                        -- game:<id>, puzzle:<jour>
  event      jsonb NOT NULL,                       -- QuestEvent
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source, event)
);
CREATE INDEX quest_events_week_idx ON quest_events (user_id, week);

-- Récompense de quête récupérée : une fois par joueur, semaine et quête.
CREATE TABLE quest_claims (
  user_id    uuid NOT NULL REFERENCES users(id),
  week       char(8) NOT NULL,
  quest_id   text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  item_code  text,                                 -- carte rare choisie, le cas échéant
  PRIMARY KEY (user_id, week, quest_id)
);

-- Habillages équipés (cartes plateau, pions, dé).
ALTER TABLE profiles
  ADD COLUMN board_card_id  uuid REFERENCES items(id),
  ADD COLUMN pieces_card_id uuid REFERENCES items(id),
  ADD COLUMN dice_card_id   uuid REFERENCES items(id);

-- Raisonnement (bêta) : « Me prévenir à l'ouverture ».
CREATE TABLE reasoning_waitlist (
  user_id    uuid PRIMARY KEY REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);
