# Maquette Kwatt

Copie des planches du canevas « Kwatt — hub de jeux » (claude.ai, 62 planches). Chaque fichier `*.dc.html` est une planche : du HTML avec des styles en ligne et, dans le bloc `<script type="text/x-dc">`, une classe `Component` dont `renderVals()` contient les données et les variantes de l'écran (états, listes, textes).

- `canvas.json` : index des planches, avec leur **titre** (numéro d'écran) et leur position.
- Les écrans font 390 × 844 (téléphone), sauf les planches « Réf » (1 520 de large) et la tablette (1 194 × 834).
- Les liens `href="X.dc.html"` donnent la navigation entre écrans.
- Pour lire une planche : ouvrir le fichier, ou en extraire le texte (`python3 -c` avec une expression régulière qui retire les balises).

Les données affichées (Brice, Mireille, 2 450 cauris…) sont des **exemples** : l'appli affiche les vraies données du joueur.

| Écran | Fichier | Écran | Fichier |
|---|---|---|---|
| 00 Sommaire | Sommaire | 21 Partie de Ludo | PartieLudo |
| Réf Identité | Main | 21b Ludo à 6 | PartieLudo6 |
| Réf Pourquoi | Pourquoi | 21c Pachisi, cauris | LancerCauris |
| 01 Bienvenue | Bienvenue | 22 Dé honnête | DeHonnete |
| 02 Rejoindre avec un code | RejoindreCode | 23 Règles | Regles |
| 03 Créer son profil | Inscription | 24 Créer un salon | CreerSalon |
| 04 Âge | Age | 25 Salon & file | Salon |
| 05 Premier lancement | Tutoriel | 26 Défi avec mise | Mise |
| 06 Connexion | Connexion | 27 Ligues | Ligues |
| 07 Accueil | Accueil | 28 Créer une ligue privée | CreerLigue |
| 08 Notifications | Notifications | 28b Plateaux & règles de la compétition | ReglesCompetition |
| 09 Profil | Profil | 29 Championnat | Championnat |
| 10 Studio d'avatar | AvatarStudio | 30 Coupe | Coupe |
| 11 Boutique d'avatars | AvatarBoutique | 31 Créer une ligue publique | CreerLiguePublique |
| 12 Amis | Amis | 32 Rejoindre une ligue publique | LiguePublique |
| 13 Paramètres | Parametres | 33 Valider la ligue | ValiderLigue |
| 14 Dames : mode | ModeDames | 34 Match du jour & forfait | MatchDuJour |
| 15 Défi machine | DefiMachine | 34b Choisir la planche | ChoixPlanche |
| 16 Partie de dames | PartieDames | 35 Exclusion | Exclusion |
| 16b Dames 8×8 | PartieDames8 | 36 Guerre des quartiers | Quartiers |
| 17 Plein soleil | PleinSoleil | 37 Autour du damier | KwattTV |
| 18 Fin de partie | Resultat | 38 Signaler | Signaler |
| 19 Revoir | Revoir | 39 Cartes | Cartes |
| 19b Problème du jour | ProblemeDuJour | 40 Médailles & quêtes | Recompenses |
| 20 Ludo : mode | ModeLudo | 41 Échelons | Echelons |
| 20b Ludo : plateau & règles | LudoVariantes | 42 Raisonnement | Raisonnement |
| | | 43 Tablette | TabletteDames |

Planches de référence : `Parcours` (navigation), `Systeme` (données, cauris, comptes), `RegleLigues`, `Matrice`, `Audit`, `Adaptation` (tailles d'écran), `Moteur` (IA), `VariantesLudo`, `RegleCompet`.
