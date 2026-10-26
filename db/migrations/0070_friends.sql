-- Kwatt · communauté : amis, codes d'ami, blocages (écrans 12 et 38). Plage 0070–0079.

-- Code d'ami de chaque joueur (lien kwatt://ami/CODE) : 6 caractères sans 0/O/1/I.
CREATE TABLE friend_codes (
  user_id    uuid PRIMARY KEY REFERENCES users(id),
  code       char(6) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Une ligne par paire (user_a < user_b) : demande en attente puis amitié.
CREATE TABLE friendships (
  user_a       uuid NOT NULL REFERENCES users(id),
  user_b       uuid NOT NULL REFERENCES users(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  status       text NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b),
  CHECK (requested_by IN (user_a, user_b))
);
CREATE INDEX friendships_b_idx ON friendships (user_b);

-- Blocages : le bloqué ne peut plus t'inviter, te défier ni t'écrire (vérifié côté serveur).
CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES users(id),
  blocked_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id);
