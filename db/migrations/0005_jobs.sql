-- Kwatt · fondation serveur : suivi des tâches planifiées (effacement des comptes, purges…).
-- L'exclusion mutuelle passe par un verrou consultatif PostgreSQL ; cette table garde la trace.

CREATE TABLE job_runs (
  name             text PRIMARY KEY,
  last_started_at  timestamptz,
  last_finished_at timestamptz,
  last_error       text,
  run_count        integer NOT NULL DEFAULT 0
);
