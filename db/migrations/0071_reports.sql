-- Kwatt · communauté : signalements et file de modération (écran 38). Plage 0070–0079.
-- La partie concernée est jointe automatiquement (dernière partie jouée ensemble) : la
-- modération revoit chaque coup. Un seul signalement ouvert par paire signaleur → signalé.

CREATE TABLE reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users(id),
  reported_id uuid NOT NULL REFERENCES users(id),
  reason      text NOT NULL CHECK (reason IN ('outside_help', 'insults', 'photo', 'multi_account', 'other')),
  message     text CHECK (message IS NULL OR char_length(message) <= 500),
  game_id     uuid REFERENCES games(id),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'warned', 'actioned')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  note        text,                                  -- note de la modération (jamais montrée)
  CHECK (reporter_id <> reported_id)
);
CREATE UNIQUE INDEX reports_open_pair ON reports (reporter_id, reported_id) WHERE status = 'open';
CREATE INDEX reports_open_idx ON reports (created_at) WHERE status = 'open';
CREATE INDEX reports_reported_idx ON reports (reported_id);
