-- Kwatt · fondation serveur : comptes, appareils, sessions, codes (SPEC §6).
-- Complète 0001 sans la modifier.

-- Appareils -----------------------------------------------------------------
-- Le web sert à la vérification par captures (export web de l'appli).
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_platform_check;
ALTER TABLE devices ADD CONSTRAINT devices_platform_check CHECK (platform IN ('android','ios','web'));
ALTER TABLE devices ADD COLUMN app_version text;

-- Lien compte ↔ appareil : sert à interdire les mises entre comptes du même appareil.
ALTER TABLE user_devices
  ADD COLUMN first_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_seen_at  timestamptz NOT NULL DEFAULT now();
CREATE INDEX user_devices_device ON user_devices (device_id);

-- Comptes -------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN terms_accepted_at  timestamptz,   -- règles du quartier + politique de confidentialité
  ADD COLUMN last_seen_at       timestamptz,   -- dernière présence (temps réel)
  ADD COLUMN erased_at          timestamptz;   -- données personnelles effacées (J+30 après la demande)

-- Un compte effacé n'a plus d'année de naissance.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_check;
ALTER TABLE users ADD CONSTRAINT users_birth_year_check
  CHECK (kind = 'guest' OR birth_year IS NOT NULL OR erased_at IS NOT NULL);
ALTER TABLE users ADD CONSTRAINT users_locale_check CHECK (locale IN ('fr','en'));
CREATE INDEX users_deletion_due ON users (delete_requested_at)
  WHERE delete_requested_at IS NOT NULL AND erased_at IS NULL;

ALTER TABLE profiles ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX auth_identities_user ON auth_identities (user_id);

-- Sessions ------------------------------------------------------------------
-- Une session par appareil connecté ; ses jetons de renouvellement tournent.
-- Le jeton d'accès porte l'identifiant de session : une session fermée refuse ses jetons.
CREATE TABLE auth_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  device_id     uuid NOT NULL REFERENCES devices(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoke_reason text CHECK (revoke_reason IN (
    'logout','logout_all','password_reset','password_change','refresh_reuse',
    'account_deleted','guest_converted','admin'))
);
CREATE INDEX auth_sessions_user_active ON auth_sessions (user_id) WHERE revoked_at IS NULL;

ALTER TABLE refresh_tokens
  ADD COLUMN session_id uuid REFERENCES auth_sessions(id),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX refresh_tokens_session ON refresh_tokens (session_id);
CREATE INDEX refresh_tokens_user ON refresh_tokens (user_id);

-- Codes à 6 chiffres (vérification de l'adresse, mot de passe oublié) ---------
ALTER TABLE otp_codes ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX otp_codes_identity ON otp_codes (identity_id, purpose, created_at DESC);

-- Étape 3 de « mot de passe oublié » : le code validé donne un jeton à usage unique (15 min).
CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES auth_identities(id),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_identity ON password_reset_tokens (identity_id);
