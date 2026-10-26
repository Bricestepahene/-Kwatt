-- Kwatt · collection de 48 cartes (écran 39) : tables, plateaux, dés, pions, pouvoirs
-- (commodités, jamais un avantage de jeu : D-14) et trophées. La carte « Trophée Ngondo »
-- (0060, ligues) complète les 47 ci-dessous. Noms et effets : catalogue items.json de l'appli.
--
-- render : { type: table|plateau|pions|pouvoir|trophee, slot?: board|pieces|dice (habillage
-- équipable), game: dames|ludo|both, fabric, how: start|rank|quest|streak|feat|trophy, … }
--   rank    → échelon atteint (render.rank) dans au moins un jeu ;
--   quest   → les trois quêtes d'une semaine terminées (une carte par semaine) ;
--   streak  → carte rare au choix au 7e jour de suite ; render.days : série plus longue ;
--   feat    → victoire marquante (render.feat) ;
--   trophy  → ligue (médaille d'argent, de bronze) ou quartier champion de la saison.
-- Éditions numérotées : edition_total.

INSERT INTO items (code, kind, rarity, price, edition_total, min_rank, is_default, render, sort_order) VALUES
  ('card_table_village', 'card', 'commune', NULL, NULL, NULL, true, '{"type":"table","game":"both","fabric":"obom","how":"rank","rank":"apprenti","effect":"table_limit","limit":50}', 800),
  ('card_table_marche', 'card', 'commune', NULL, NULL, 'debrouillard', false, '{"type":"table","game":"both","fabric":"kaba","how":"rank","rank":"debrouillard","effect":"table_limit","limit":100}', 801),
  ('card_table_ancien', 'card', 'rare', NULL, NULL, 'ancien', false, '{"type":"table","game":"both","fabric":"ndop","how":"rank","rank":"ancien","effect":"table_limit","limit":200}', 802),
  ('card_table_wouri', 'card', 'rare', NULL, NULL, 'notable', false, '{"type":"table","game":"both","fabric":"obom","how":"rank","rank":"notable","effect":"table_limit","limit":500}', 803),
  ('card_table_mont_cameroun', 'card', 'legendaire', NULL, NULL, 'chef', false, '{"type":"table","game":"both","fabric":"toghu","how":"rank","rank":"chef","effect":"table_limit","limit":2000}', 804),
  ('card_trone_du_fon', 'card', 'legendaire', NULL, NULL, 'fon', false, '{"type":"table","game":"both","fabric":"toghu","how":"rank","rank":"fon","effect":"table_limit","limit":5000}', 805),
  ('card_damier_bois', 'card', 'commune', NULL, NULL, NULL, true, '{"type":"plateau","game":"dames","fabric":"obom","how":"start","slot":"board"}', 806),
  ('card_damier_ndop', 'card', 'epique', NULL, NULL, NULL, false, '{"type":"plateau","game":"dames","fabric":"ndop","how":"quest","slot":"board"}', 807),
  ('card_damier_kaba', 'card', 'rare', NULL, NULL, NULL, false, '{"type":"plateau","game":"dames","fabric":"kaba","how":"streak","slot":"board"}', 808),
  ('card_damier_toghu', 'card', 'epique', NULL, NULL, NULL, false, '{"type":"plateau","game":"dames","fabric":"toghu","how":"feat","slot":"board","feat":"upset_dames"}', 809),
  ('card_damier_obom', 'card', 'commune', NULL, NULL, NULL, false, '{"type":"plateau","game":"dames","fabric":"obom","how":"quest","slot":"board"}', 810),
  ('card_ludo_classique', 'card', 'commune', NULL, NULL, NULL, true, '{"type":"plateau","game":"ludo","fabric":"kaba","how":"start","slot":"board"}', 811),
  ('card_ludo_ndop', 'card', 'rare', NULL, NULL, NULL, false, '{"type":"plateau","game":"ludo","fabric":"ndop","how":"streak","slot":"board"}', 812),
  ('card_ludo_toghu', 'card', 'epique', NULL, NULL, NULL, false, '{"type":"plateau","game":"ludo","fabric":"toghu","how":"feat","slot":"board","feat":"upset_ludo"}', 813),
  ('card_ludo_obom', 'card', 'rare', NULL, NULL, NULL, false, '{"type":"plateau","game":"ludo","fabric":"obom","how":"streak","slot":"board"}', 814),
  ('card_ludo_wouri', 'card', 'legendaire', NULL, 300, NULL, false, '{"type":"plateau","game":"ludo","fabric":"ndop","how":"feat","slot":"board","feat":"wins_250"}', 815),
  ('card_de_kaba', 'card', 'commune', NULL, NULL, NULL, false, '{"type":"plateau","game":"ludo","fabric":"kaba","how":"quest","slot":"dice"}', 816),
  ('card_de_ndop', 'card', 'rare', NULL, NULL, NULL, false, '{"type":"plateau","game":"ludo","fabric":"ndop","how":"streak","slot":"dice"}', 817),
  ('card_de_toghu', 'card', 'epique', NULL, NULL, NULL, false, '{"type":"plateau","game":"ludo","fabric":"toghu","how":"feat","slot":"dice","feat":"wins_10"}', 818),
  ('card_de_obom', 'card', 'commune', NULL, NULL, NULL, false, '{"type":"plateau","game":"ludo","fabric":"obom","how":"quest","slot":"dice"}', 819),
  ('card_de_cauris', 'card', 'rare', NULL, NULL, NULL, false, '{"type":"plateau","game":"ludo","fabric":"obom","how":"streak","slot":"dice"}', 820),
  ('card_de_or', 'card', 'legendaire', NULL, 500, NULL, false, '{"type":"plateau","game":"ludo","fabric":"toghu","how":"feat","slot":"dice","feat":"wins_200"}', 821),
  ('card_pions_toghu', 'card', 'epique', NULL, NULL, NULL, false, '{"type":"pions","game":"dames","fabric":"toghu","how":"feat","slot":"pieces","feat":"rafle_4"}', 822),
  ('card_pions_ndop', 'card', 'rare', NULL, NULL, NULL, false, '{"type":"pions","game":"dames","fabric":"ndop","how":"streak","slot":"pieces"}', 823),
  ('card_pions_kaba', 'card', 'commune', NULL, NULL, NULL, false, '{"type":"pions","game":"dames","fabric":"kaba","how":"quest","slot":"pieces"}', 824),
  ('card_pions_obom', 'card', 'commune', NULL, NULL, NULL, false, '{"type":"pions","game":"dames","fabric":"obom","how":"quest","slot":"pieces"}', 825),
  ('card_pions_ebene', 'card', 'rare', NULL, NULL, NULL, false, '{"type":"pions","game":"dames","fabric":"obom","how":"streak","slot":"pieces"}', 826),
  ('card_pions_ivoire', 'card', 'epique', NULL, NULL, NULL, false, '{"type":"pions","game":"dames","fabric":"ndop","how":"feat","slot":"pieces","feat":"rafle_5"}', 827),
  ('card_pions_ludo_kaba', 'card', 'commune', NULL, NULL, NULL, false, '{"type":"pions","game":"ludo","fabric":"kaba","how":"quest","slot":"pieces"}', 828),
  ('card_pions_ludo_ndop', 'card', 'rare', NULL, NULL, NULL, false, '{"type":"pions","game":"ludo","fabric":"ndop","how":"streak","slot":"pieces"}', 829),
  ('card_pions_ludo_toghu', 'card', 'epique', NULL, NULL, NULL, false, '{"type":"pions","game":"ludo","fabric":"toghu","how":"feat","slot":"pieces","feat":"ludo_table_4"}', 830),
  ('card_pions_ludo_obom', 'card', 'commune', NULL, NULL, NULL, false, '{"type":"pions","game":"ludo","fabric":"obom","how":"quest","slot":"pieces"}', 831),
  ('card_pions_cauris', 'card', 'rare', NULL, NULL, NULL, false, '{"type":"pions","game":"ludo","fabric":"obom","how":"streak","slot":"pieces"}', 832),
  ('card_pions_masques', 'card', 'legendaire', NULL, 500, NULL, false, '{"type":"pions","game":"both","fabric":"toghu","how":"streak","slot":"pieces","days":60}', 833),
  ('card_pouvoir_revanche', 'card', 'rare', NULL, NULL, NULL, false, '{"type":"pouvoir","game":"both","fabric":"ndop","how":"quest","effect":"instant_rematch"}', 834),
  ('card_pouvoir_place_gardee', 'card', 'rare', NULL, NULL, NULL, false, '{"type":"pouvoir","game":"both","fabric":"obom","how":"streak","effect":"seat_kept_longer"}', 835),
  ('card_pouvoir_salon_couleurs', 'card', 'commune', NULL, NULL, NULL, false, '{"type":"pouvoir","game":"both","fabric":"kaba","how":"quest","effect":"room_colors"}', 836),
  ('card_pouvoir_reactions', 'card', 'commune', NULL, NULL, NULL, false, '{"type":"pouvoir","game":"both","fabric":"kaba","how":"quest","effect":"more_reactions"}', 837),
  ('card_pouvoir_revoir_annote', 'card', 'rare', NULL, NULL, NULL, false, '{"type":"pouvoir","game":"dames","fabric":"ndop","how":"feat","feat":"first_win","effect":"annotated_replay"}', 838),
  ('card_pouvoir_tribune', 'card', 'rare', NULL, NULL, NULL, false, '{"type":"pouvoir","game":"both","fabric":"toghu","how":"streak","effect":"front_row"}', 839),
  ('card_pouvoir_lien_salon', 'card', 'epique', NULL, NULL, NULL, false, '{"type":"pouvoir","game":"both","fabric":"toghu","how":"feat","feat":"wins_50","effect":"custom_room_link"}', 840),
  ('card_pouvoir_album', 'card', 'legendaire', NULL, NULL, NULL, false, '{"type":"pouvoir","game":"both","fabric":"toghu","how":"feat","feat":"wins_500","effect":"game_album"}', 841),
  ('card_trophee_finaliste', 'card', 'epique', NULL, NULL, NULL, false, '{"type":"trophee","game":"both","fabric":"toghu","how":"trophy","trophy":"league_silver"}', 842),
  ('card_trophee_podium', 'card', 'rare', NULL, NULL, NULL, false, '{"type":"trophee","game":"both","fabric":"obom","how":"trophy","trophy":"league_bronze"}', 843),
  ('card_trophee_quartier', 'card', 'legendaire', NULL, NULL, NULL, false, '{"type":"trophee","game":"both","fabric":"ndop","how":"trophy","trophy":"quarter_champion"}', 844),
  ('card_trophee_serie_30', 'card', 'epique', NULL, NULL, NULL, false, '{"type":"trophee","game":"both","fabric":"kaba","how":"streak","days":30}', 845),
  ('card_trophee_cent_victoires', 'card', 'epique', NULL, NULL, NULL, false, '{"type":"trophee","game":"both","fabric":"toghu","how":"feat","feat":"wins_100"}', 846)
ON CONFLICT (code) DO NOTHING;

UPDATE items SET render = render || '{"type":"trophee","game":"both","how":"trophy","trophy":"league_gold"}'::jsonb
 WHERE code = 'card_trophee_ngondo';

-- Cadre de profil du quartier champion de la saison (donné à tous ses joueurs).
INSERT INTO items (code, kind, rarity, price, edition_total, min_rank, is_default, render, sort_order)
VALUES ('frame_quartier_champion', 'frame', 'legendaire', NULL, NULL, NULL, false, '{"fabric":"ndop","champion":true}', 48)
ON CONFLICT (code) DO NOTHING;
