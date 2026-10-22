-- Kwatt · Ludo : jeux de règles maison enregistrés et nommés (écran 20b, « les règles de Tata Odile »).
-- Plage 0050–0059 (SPEC §8). Complète 0001 sans la modifier.
--
-- Un jeu de règles = une variante de départ (preset) + les réglages maison qui en diffèrent
-- (sortie, capture, protection, barrières), validés par @kwatt/rules-ludo (validateSetup) avant
-- l'écriture. Une partie jouée avec un jeu de règles maison est amicale : pas de classement,
-- pas de mise, pas de ligue publique. Réutilisable à la création d'un salon (équipe Parties en ligne).
CREATE TABLE house_rule_sets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Nom saisi par le joueur (jamais traduit).
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  preset      text NOT NULL CHECK (preset IN ('classique', 'rapide', 'six', 'parchis', 'pachisi')),
  -- Réglages maison normalisés : {exit?, capture?, protection?, barriers?}, au moins un.
  rules       jsonb NOT NULL CHECK (jsonb_typeof(rules) = 'object' AND rules <> '{}'::jsonb),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Un nom par joueur, sans tenir compte de la casse ni des espaces autour.
CREATE UNIQUE INDEX house_rule_sets_owner_name ON house_rule_sets (owner_id, lower(btrim(name)));
CREATE INDEX house_rule_sets_owner ON house_rule_sets (owner_id, updated_at DESC);
