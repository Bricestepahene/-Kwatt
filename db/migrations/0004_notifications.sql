-- Kwatt · fondation serveur : notifications (écran 08), push Expo, réglages (écran 13).

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  kind       text NOT NULL,                    -- '<catégorie>.<nom>', ex. 'turn.your_turn'
  params     jsonb NOT NULL DEFAULT '{}',      -- traduit par l'appli, jamais une phrase
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread ON notifications (user_id) WHERE read_at IS NULL;

-- Jetons push Expo : un par installation ; repris par le dernier compte connecté sur l'appareil.
CREATE TABLE push_tokens (
  token        text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id),
  device_id    uuid REFERENCES devices(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  disabled_at  timestamptz                      -- DeviceNotRegistered, déconnexion
);
CREATE INDEX push_tokens_user ON push_tokens (user_id) WHERE disabled_at IS NULL;

-- Réglages « Notifications » de l'écran 13 (absence de ligne = tout activé).
CREATE TABLE notification_preferences (
  user_id    uuid PRIMARY KEY REFERENCES users(id),
  turn       boolean NOT NULL DEFAULT true,
  invites    boolean NOT NULL DEFAULT true,
  league     boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
