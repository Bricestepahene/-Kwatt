-- Kwatt · catalogue de départ : pièces d'avatar, cadres de tissu, avatars prêts.
-- Prix et raretés des planches AvatarStudio (écran 10), AvatarBoutique (écran 11),
-- Inscription (cadres de base) et Échelons (« Trône du Fon · cadre légendaire »).
-- Les noms ne sont pas ici : l'appli traduit chaque code (catalogue items.json, fr et en).

INSERT INTO items (code, kind, rarity, price, edition_total, min_rank, is_default, render, sort_order) VALUES
  -- Teints (5, de base) : indice dans avatarSkins de @kwatt/design.
  ('skin_1', 'avatar_skin', 'commune', NULL, NULL, NULL, true, '{"tone":0}', 10),
  ('skin_2', 'avatar_skin', 'commune', NULL, NULL, NULL, true, '{"tone":1}', 11),
  ('skin_3', 'avatar_skin', 'commune', NULL, NULL, NULL, true, '{"tone":2}', 12),
  ('skin_4', 'avatar_skin', 'commune', NULL, NULL, NULL, true, '{"tone":3}', 13),
  ('skin_5', 'avatar_skin', 'commune', NULL, NULL, NULL, true, '{"tone":4}', 14),

  -- Coiffes (« Aucune » n'est pas un objet : coiffe vide).
  ('hat_ndop',  'avatar_hat', 'commune', NULL, NULL, NULL, true,  '{"fabric":"ndop","shape":"bonnet"}', 20),
  ('hat_kaba',  'avatar_hat', 'commune', 150,  NULL, NULL, false, '{"fabric":"kaba","shape":"foulard"}', 21),
  ('hat_toghu', 'avatar_hat', 'rare',    600,  NULL, NULL, false, '{"fabric":"toghu","shape":"toque"}', 22),

  -- Tenues.
  ('outfit_obom',  'avatar_outfit', 'commune', NULL, NULL, NULL, true,  '{"fabric":"obom"}', 30),
  ('outfit_ndop',  'avatar_outfit', 'commune', 120,  NULL, NULL, false, '{"fabric":"ndop"}', 31),
  ('outfit_kaba',  'avatar_outfit', 'commune', 200,  NULL, NULL, false, '{"fabric":"kaba"}', 32),
  ('outfit_toghu', 'avatar_outfit', 'rare',    900,  NULL, NULL, false, '{"fabric":"toghu"}', 33),

  -- Cadres de tissu : les quatre de base (choisis à l'inscription), le cadre légendaire du Fon.
  ('frame_ndop',         'frame', 'commune',    NULL, NULL, NULL,  true,  '{"fabric":"ndop"}', 40),
  ('frame_toghu',        'frame', 'commune',    NULL, NULL, NULL,  true,  '{"fabric":"toghu"}', 41),
  ('frame_kaba',         'frame', 'commune',    NULL, NULL, NULL,  true,  '{"fabric":"kaba"}', 42),
  ('frame_obom',         'frame', 'commune',    NULL, NULL, NULL,  true,  '{"fabric":"obom"}', 43),
  ('frame_trone_du_fon', 'frame', 'legendaire', NULL, NULL, 'fon', false, '{"fabric":"toghu"}', 49),

  -- Avatars prêts (boutique).
  ('preset_debrouillard', 'avatar_preset', 'commune',    80,   NULL, NULL, false,
     '{"skin":2,"hat":{"fabric":"ndop","shape":"bonnet"},"outfit":"ndop","background":"obom"}', 50),
  ('preset_commercante',  'avatar_preset', 'commune',    120,  NULL, NULL, false,
     '{"skin":3,"hat":{"fabric":"kaba","shape":"foulard"},"outfit":"ndop","background":"kaba"}', 51),
  ('preset_balafoniste',  'avatar_preset', 'rare',       450,  NULL, NULL, false,
     '{"skin":1,"hat":{"fabric":"toghu","shape":"bonnet"},"outfit":"obom","background":"ndop"}', 52),
  ('preset_reine_ludo',   'avatar_preset', 'rare',       600,  NULL, NULL, false,
     '{"skin":4,"hat":{"fabric":"toghu","shape":"couronne"},"outfit":"toghu","background":"kaba"}', 53),
  ('preset_notable',      'avatar_preset', 'epique',     1500, NULL, NULL, false,
     '{"skin":2,"hat":{"fabric":"obom","shape":"toque"},"outfit":"ndop","background":"toghu"}', 54),
  ('preset_fon',          'avatar_preset', 'legendaire', 5000, NULL, NULL, false,
     '{"skin":3,"hat":{"fabric":"ndop","shape":"couronne"},"outfit":"ndop","background":"toghu"}', 55),
  -- Édition limitée du Ngondo 2026 : 500 exemplaires numérotés, ne revient jamais.
  ('preset_prince_wouri', 'avatar_preset', 'legendaire', 2400, 500,  NULL, false,
     '{"skin":3,"hat":{"fabric":"toghu","shape":"couronne"},"outfit":"toghu","background":"kaba","event":"ngondo_2026"}', 49);
