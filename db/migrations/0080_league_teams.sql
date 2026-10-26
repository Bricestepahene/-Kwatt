-- Compétitions par équipes (planche RegleCompet, « Matchs par équipes ») : championnat privé,
-- Dames en équipes de 3 (trois planches en même temps), Ludo en équipes de 2 (une table de 4).
-- Une rencontre d'équipes regroupe ses parties (league_matches.team_match_id) ; le classement
-- et le partage de la cagnotte se font par équipe (@kwatt/domain, league/teams.ts).

ALTER TABLE leagues ADD COLUMN team_size smallint CHECK (team_size IN (2, 3));

CREATE TABLE league_teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   uuid NOT NULL REFERENCES leagues(id),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 24),
  captain_id  uuid NOT NULL REFERENCES users(id),
  draw_order  smallint,                              -- place dans le tirage au sort
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX league_teams_name_idx ON league_teams (league_id, lower(name));

ALTER TABLE league_members ADD COLUMN team_id uuid REFERENCES league_teams(id);
CREATE INDEX league_members_team_idx ON league_members (team_id);

-- Rencontre entre deux équipes : l'ordre des joueurs (Dames) est déposé par chaque capitaine
-- jusqu'à 1 h avant, puis figé (lineup_locked) et appliqué aux planches.
CREATE TABLE league_team_matches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id      uuid NOT NULL REFERENCES leagues(id),
  round          smallint NOT NULL,
  home_team      uuid NOT NULL REFERENCES league_teams(id),
  away_team      uuid NOT NULL REFERENCES league_teams(id),
  match_at       timestamptz NOT NULL,
  lineups        jsonb NOT NULL DEFAULT '{}',        -- { teamId: [userId, userId, userId] }
  lineup_locked  boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX league_team_matches_league_idx ON league_team_matches (league_id, round);
CREATE INDEX league_team_matches_due_idx ON league_team_matches (lineup_locked, match_at);

ALTER TABLE league_matches
  ADD COLUMN team_match_id uuid REFERENCES league_team_matches(id),
  ADD COLUMN board_no      smallint CHECK (board_no BETWEEN 1 AND 3);
CREATE INDEX league_matches_team_idx ON league_matches (team_match_id);
