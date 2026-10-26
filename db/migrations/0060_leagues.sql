-- Ligues (écrans 27 à 35, 28b, 34b ; planches RegleLigues et RegleCompet).
-- Toute la logique chiffrée vient de @kwatt/domain (league/*) ; la base garde l'état.
-- Les cauris passent par le grand livre : pot sur le séquestre 'league:<id>',
-- caution du créateur sur 'league-caution:<id>'.

CREATE TABLE leagues (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   text NOT NULL UNIQUE CHECK (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  name                   text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 40),
  game                   text NOT NULL CHECK (game IN ('dames','ludo')),
  access                 text NOT NULL CHECK (access IN ('private','public')),
  format                 text NOT NULL CHECK (format IN ('championship','cup')),
  creator_id             uuid NOT NULL REFERENCES users(id),
  status                 text NOT NULL DEFAULT 'registration'
                           CHECK (status IN ('registration','awaiting_validation','running','finished','cancelled')),
  max_places             smallint NOT NULL CHECK (max_places BETWEEN 2 AND 64),
  entry                  integer NOT NULL DEFAULT 0 CHECK (entry >= 0),
  caution                integer NOT NULL DEFAULT 0 CHECK (caution >= 0),
  min_rank               text,
  double_round           boolean NOT NULL DEFAULT false,
  groups                 smallint,
  qualifiers_per_group   smallint,
  rounds                 smallint,                  -- Ludo : journées voulues
  relegated              smallint NOT NULL DEFAULT 0,
  board_rules            jsonb NOT NULL,
  default_time           text NOT NULL DEFAULT '20:00',
  rhythm                 text NOT NULL DEFAULT 'daily' CHECK (rhythm IN ('daily','weekly')),
  first_day              date NOT NULL,
  registration_closes_at timestamptz,
  closed_at              timestamptz,               -- clôture effective des inscriptions
  validated_at           timestamptz,
  started_at             timestamptz,
  finished_at            timestamptz,
  cancelled_at           timestamptz,
  cancel_reason          text,
  draw_seed              text,                      -- tirage au sort, publié au lancement
  bonus                  integer NOT NULL DEFAULT 0, -- bonus Kwatt versé au pot (publique)
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leagues_public_idx ON leagues (access, status);

CREATE TABLE league_members (
  league_id    uuid NOT NULL REFERENCES leagues(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','excluded','left','removed')),
  seq          serial,                               -- ordre d'inscription
  joined_at    timestamptz NOT NULL DEFAULT now(),
  entry_paid   integer NOT NULL DEFAULT 0,
  fines_paid   integer NOT NULL DEFAULT 0,       -- amendes de forfait versées au pot
  refunded     integer NOT NULL DEFAULT 0,       -- déjà rendu (exclusion)
  draw_order   smallint,                             -- place dans le tirage au sort
  group_index  smallint,
  excluded_at  timestamptz,
  PRIMARY KEY (league_id, user_id)
);
CREATE INDEX league_members_user_idx ON league_members (user_id);

-- Un match : Dames 1 contre 1 (players = [domicile, extérieur]) ou une table de Ludo.
CREATE TABLE league_matches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id      uuid NOT NULL REFERENCES leagues(id),
  stage          text NOT NULL CHECK (stage IN ('league','group','knockout','decider')),
  round          smallint NOT NULL,
  group_index    smallint,
  tie_index      smallint,
  leg            smallint,
  level          smallint,                           -- phase finale : tour (1 = premier)
  players        uuid[] NOT NULL,
  day            date NOT NULL,
  match_at       timestamptz NOT NULL,
  time_agreed    boolean NOT NULL DEFAULT false,
  time_proposals jsonb NOT NULL DEFAULT '{}',        -- { userId: 'HH:MM' }
  board          text,                               -- décidée à l'heure du match
  board_choices  jsonb NOT NULL DEFAULT '{}',        -- { userId: { board, at } }
  arrivals       jsonb NOT NULL DEFAULT '{}',        -- { userId: iso }
  status         text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','playing','played','annulled','cancelled')),
  outcome        text,                               -- Dames : MatchOutcome de @kwatt/domain
  piece_diff     integer,
  results        jsonb,                              -- Ludo : [{ playerId, place, tokensHome }] (place null = forfait)
  game_id        uuid,
  reminders      text[] NOT NULL DEFAULT '{}',       -- rappels déjà envoyés : eve, 1h, 10m
  played_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX league_matches_league_idx ON league_matches (league_id, round);
CREATE INDEX league_matches_due_idx ON league_matches (status, match_at);
CREATE UNIQUE INDEX league_matches_game_idx ON league_matches (game_id) WHERE game_id IS NOT NULL;

-- Exclusions (écran 35) : le récit chiffré est figé au moment de l'exclusion.
CREATE TABLE league_exclusions (
  league_id   uuid NOT NULL REFERENCES leagues(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  round       smallint NOT NULL,
  details     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, user_id)
);

-- Médailles (écrans 40 et 09) : écrites par les ligues à la clôture.
CREATE TABLE IF NOT EXISTS medals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  league_id  uuid REFERENCES leagues(id),
  kind       text NOT NULL CHECK (kind IN ('or','argent','bronze')),
  title      text NOT NULL,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, league_id)
);

-- Carte trophée remise au champion d'une ligue (écran 28 : « carte Trophée Ngondo »).
-- Si l'équipe Communauté la déclare aussi dans son catalogue de cartes, la première écrite reste.
INSERT INTO items (code, kind, rarity, price, edition_total, min_rank, is_default, render, sort_order)
VALUES ('card_trophee_ngondo', 'card', 'legendaire', NULL, NULL, NULL, false, '{"trophy":true,"fabric":"toghu"}', 900)
ON CONFLICT (code) DO NOTHING;
