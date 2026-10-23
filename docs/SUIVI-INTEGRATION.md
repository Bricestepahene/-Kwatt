# Suivi d'intégration

Points relevés par les équipes lors des fusions, à traiter pendant la vérification de bout en bout (vague 3).

## À corriger
- [x] **Adresse du serveur dans l’export web** : l'export web garde `extra.apiUrl = http://localhost:8080` malgré `EXPO_PUBLIC_API_URL` (app.config.ts / src/config). À corriger avant tout déploiement web ou build EAS. Corrigé : `src/config/env.ts` lit d’abord les variables EXPO_PUBLIC_ (le manifeste `extra` restait en cache de Metro d’un export à l’autre).
- [x] **Ludo Rapide, abandon** : une partie Rapide abandonnée est rejouée par le serveur comme « finie au temps », ce qui peut la compter gagnée si le joueur menait. Ajouter une entrée « abandon » à la notation Ludo (rules-ludo `notation.ts`) et la gérer dans `replayLudo`. Corrigé : entrée « x:siège » (`recordQuit`), écrite par la partie locale à l'abandon ; `replayLudo` la compte comme un abandon (perdu, dernier). L'équipe Parties en ligne peut l'utiliser pour la sortie après absence.
- [ ] **IA Ludo, niveau Fon** : pas plus forte que « Ton niveau » (CALIBRATION.md). Renforcer l'agent Fon et recalibrer la table des cotes.
- [x] **Historique local Ludo** : les règles maison ne sont pas gardées, l'écran 19 se rabat sur la liste des coups. Corrigé : `LocalGame.house`, rejouée par `replayFor` (écran 19). Reste pour Parties en ligne : le résumé `GET /v1/games/:id` (C3) ne porte pas encore les règles maison d'un salon.
- [ ] **Comptes jeunes visibles des amis** : brancher `registerProfileRelation` (Profil) depuis le module amis (Communauté).
- [ ] **Raretés et couleurs Plein soleil** non données par les planches (lossSoft, gainSoftText…) : vérifier le contraste.

## À vérifier sur un vrai téléphone (Expo Go / EAS)
- Photo de profil (prise, recadrage, envoi), partage du fichier d'export, jeton push, collage automatique du code.
- Déterminisme du moteur des dames entre Hermes (téléphone) et V8 (serveur) pour le rejeu hors connexion ; durée de réflexion du niveau Fon.
- Capteur de lumière (thème Automatique), orientation tablette.

## À relire par quelqu'un du terrain
- Liste des quartiers des villes moyennes (Bafoussam, Garoua, Maroua, Ngaoundéré).
