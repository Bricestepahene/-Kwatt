-- Kwatt · comptes : nom de partie d'un invité (écran 02 « Ton nom pour la partie »).
-- Un profil joue sous son pseudo ; un invité n'a pas de pseudo, il choisit un nom affiché
-- dans les salons (« Tonton Paul »). Jamais unique, jamais traduit. Effacé avec le compte.
-- Lecture conseillée pour les salons : COALESCE(profiles.pseudo, users.display_name).

ALTER TABLE users
  ADD COLUMN display_name text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 2 AND 20);
