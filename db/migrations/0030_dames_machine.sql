-- Kwatt · dames et machine (écrans 14 à 19b) : force par variante (C1), défi contre la
-- machine et parties jouées hors connexion (C2), problème du jour (19b).
-- Plage 0030–0039 (SPEC §8). Complète 0001 sans la modifier.

-- Force (C1) -------------------------------------------------------------------------------
-- Départ à 900 (SPEC §7, D-06) et bilan par variante (écran 09 : V / N / D).
ALTER TABLE player_ratings ALTER COLUMN rating SET DEFAULT 900;
ALTER TABLE player_ratings ADD COLUMN wins   integer NOT NULL DEFAULT 0 CHECK (wins >= 0);
ALTER TABLE player_ratings ADD COLUMN draws  integer NOT NULL DEFAULT 0 CHECK (draws >= 0);
ALTER TABLE player_ratings ADD COLUMN losses integer NOT NULL DEFAULT 0 CHECK (losses >= 0);

-- Une partie ne compte qu'une fois par joueur : rating_history (user, variante, partie) est
-- déjà unique (0001). On y ajoute le contexte, pour les statistiques de calibrage.
ALTER TABLE rating_history ADD COLUMN opponent_rating integer;
ALTER TABLE rating_history ADD COLUMN context text CHECK (context IN ('machine','room','league'));
CREATE INDEX rating_history_user_recent ON rating_history (user_id, variant, created_at DESC);

-- Machine : difficulté automatique et série de victoires, par joueur et par jeu ------------
CREATE TABLE machine_progress (
  user_id          uuid NOT NULL REFERENCES users(id),
  family           game_family NOT NULL,
  -- Difficulté automatique (écran 14) : monte après 3 victoires, baisse après 3 défaites.
  auto_difficulty  text NOT NULL DEFAULT 'ton_niveau'
                   CHECK (auto_difficulty IN ('facile','moyen','coriace','ton_niveau','fon')),
  -- > 0 : victoires de suite ; < 0 : défaites de suite (difficulté automatique seulement).
  auto_streak      smallint NOT NULL DEFAULT 0,
  -- Victoires de suite contre la machine (série ×1,5, écran 15).
  win_streak       integer NOT NULL DEFAULT 0 CHECK (win_streak >= 0),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, family)
);

-- Parties contre la machine réglées par le serveur ------------------------------------------
-- Hors connexion (POST /v1/machine/results, idempotent par client_game_id) ou en ligne
-- (settleMachineOnline, game_id renseigné). La réponse est gardée telle quelle : un renvoi
-- du même résultat rend exactement la même réponse.
CREATE TABLE machine_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  client_game_id  text,
  game_id         uuid REFERENCES games(id),
  family          game_family NOT NULL,
  variant         game_variant NOT NULL,
  difficulty      text NOT NULL CHECK (difficulty IN ('facile','moyen','coriace','ton_niveau','fon')),
  mode            text NOT NULL CHECK (mode IN ('auto','chosen')),
  machines        smallint NOT NULL DEFAULT 1 CHECK (machines BETWEEN 1 AND 5),
  machine_rating  integer NOT NULL,
  seed            bigint,
  moves           jsonb NOT NULL DEFAULT '[]',
  outcome         text NOT NULL CHECK (outcome IN ('win','loss','draw')),
  bet             integer NOT NULL DEFAULT 0 CHECK (bet >= 0),
  day             date NOT NULL,
  played_at       timestamptz NOT NULL,
  response        jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (client_game_id IS NOT NULL OR game_id IS NOT NULL)
);
CREATE UNIQUE INDEX machine_results_client ON machine_results (user_id, client_game_id) WHERE client_game_id IS NOT NULL;
CREATE UNIQUE INDEX machine_results_game ON machine_results (user_id, game_id) WHERE game_id IS NOT NULL;
CREATE INDEX machine_results_user_recent ON machine_results (user_id, created_at DESC);

-- Problème du jour (écran 19b) ---------------------------------------------------------------
CREATE TABLE puzzle_solves (
  user_id    uuid NOT NULL REFERENCES users(id),
  day        date NOT NULL,                    -- jour du Cameroun (UTC+1)
  variant    game_variant NOT NULL,
  puzzle_id  text NOT NULL,
  moves      jsonb NOT NULL,
  solved_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)                   -- +10 cauris une fois par jour
);
CREATE INDEX puzzle_solves_day ON puzzle_solves (day, variant);

-- Tentatives (ratées ou réussies), pour « 48 % ont trouvé » et la série de jours.
CREATE TABLE puzzle_attempts (
  user_id    uuid NOT NULL REFERENCES users(id),
  day        date NOT NULL,
  variant    game_variant NOT NULL,
  attempts   integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  solved     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, day, variant)
);

-- Série de jours du problème du jour : 7 jours de suite → carte rare au choix.
CREATE TABLE puzzle_streaks (
  user_id    uuid PRIMARY KEY REFERENCES users(id),
  last_day   integer,                          -- numéro de jour (@kwatt/domain dayNumber)
  length     integer NOT NULL DEFAULT 0 CHECK (length >= 0),
  best       integer NOT NULL DEFAULT 0 CHECK (best >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
