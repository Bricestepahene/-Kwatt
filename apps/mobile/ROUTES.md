# Routes de l’appli Kwatt

<!-- Fichier généré depuis src/navigation/routes.ts : ne pas modifier à la main. -->
<!-- Pour le réécrire : pnpm --filter @kwatt/mobile routes:doc -->

Chaque écran du Sommaire (`docs/maquette/README.md`) a sa route, déjà branchée sur la navigation, la garde de session et les traductions (`screens:<clé>.title` et `.lead`). Chaque équipe **remplace le contenu du fichier de route** par son écran, sans changer son chemin ; la logique va dans `src/features/<nom>/`, les textes dans `src/i18n/locales/{fr,en}/<nom>.json`.

- **Groupes** : `(auth)` pour l’entrée dans l’appli (01–06), `(tabs)` pour les cinq onglets (Accueil, Jouer, Ligues, Cartes, Profil), les autres écrans s’empilent par-dessus (sans barre du bas, comme pendant une partie).
- **Jouer** (`/jouer`) rouvre le dernier espace utilisé (Dames par défaut), gardé dans les préférences (`lastSpace`).
- **Garde de session** (`src/navigation/SessionGate.tsx`, règles dans `access.ts`) : sans session → Bienvenue (avec `?next=` pour revenir) ; invité → seulement les routes « Session » ou « Tout le monde » ; « 18 ans et plus » → retour à l’accueil avec un message. Après une connexion, l’écran d’entrée déclare la suite avec `setAfterSignIn(chemin)` (`src/navigation/intent.ts`) au lieu de naviguer lui-même.
- **Liens profonds** : `kwatt://salon/CODE` → `/salon/CODE`, `kwatt://ligue/CODE` → `/ligue/CODE` (le code d’invitation sert d’identifiant), `kwatt://ami/CODE` → `/ami/CODE`, `https://<domaine>/s/CODE` → `/salon/CODE`. Les codes sont normalisés (`m4t-k9q` → `M4TK9Q`) par `app/+native-intent.tsx` (`src/navigation/deepLinks.ts`).
- **Accès** : la colonne reprend le Sommaire et la planche « Réf · Matrice » ; le serveur refait toutes les vérifications.

| Écran | Clé | Fichier de route | URL | Planche(s) | Accès | Équipe | Remarque |
|---|---|---|---|---|---|---|---|
| 01 | `bienvenue` | `app/(auth)/bienvenue.tsx` | `/bienvenue` | Bienvenue | Sans profil (sans session ou invité) | Comptes | Page d’arrivée sans session et « accueil » des invités. Prévoir le choix FR/EN ici (un invité n’a pas accès aux Paramètres). |
| 02 | `rejoindre` | `app/(auth)/rejoindre.tsx` | `/rejoindre` | RejoindreCode | Tout le monde | Comptes | Paramètre facultatif `?code=ABCDEF` (lien kwatt://salon/CODE ouvert sans session). Crée la session invitée. |
| 03 | `inscription` | `app/(auth)/inscription.tsx` | `/inscription` | Inscription | Sans profil (sans session ou invité) | Comptes | Un invité qui s’inscrit garde ses parties (compte converti). |
| 03 | `verifierEmail` | `app/(auth)/verifier-email.tsx` | `/verifier-email` | Inscription | Profil | Comptes | Étape « code à 6 chiffres » de l’inscription (CodeInput). |
| 04 | `age` | `app/(auth)/age.tsx` | `/age` | Age | Sans profil (sans session ou invité) | Comptes |  |
| 05 | `premierLancement` | `app/(auth)/premier-lancement.tsx` | `/premier-lancement` | Tutoriel | Profil | Comptes |  |
| 06 | `connexion` | `app/(auth)/connexion.tsx` | `/connexion` | Connexion | Sans profil (sans session ou invité) | Comptes |  |
| 06 | `motDePasseOublie` | `app/(auth)/mot-de-passe-oublie.tsx` | `/mot-de-passe-oublie` | Connexion | Tout le monde | Comptes | Feuille « mot de passe oublié » (contact → code → nouveau mot de passe), présentée en feuille. |
| 07 | `accueil` | `app/(tabs)/index.tsx` | `/` | Accueil | Profil | Communauté et progression |  |
| 08 | `notifications` | `app/notifications.tsx` | `/notifications` | Notifications | Profil | Communauté et progression |  |
| 09 | `profil` | `app/(tabs)/profil.tsx` | `/profil` | Profil | Profil | Profil |  |
| 09 | `profilCauris` | `app/profil/cauris.tsx` | `/profil/cauris` | Profil, Systeme | Profil | Profil | Journal des cauris (« Mouvement » de la planche Système : qui, combien, pourquoi, partie liée), sur GET /v1/wallet/journal. |
| 09 | `joueur` | `app/joueur/[id].tsx` | `/joueur/[id]` | Profil | Session (invité ou profil) | Profil | Profil public d’un autre joueur (écran 09 en lecture, GET /v1/profiles/:userId) ; un compte jeune est invisible des inconnus. |
| 10 | `avatarStudio` | `app/avatar/index.tsx` | `/avatar` | AvatarStudio | Profil | Profil |  |
| 11 | `avatarBoutique` | `app/avatar/boutique.tsx` | `/avatar/boutique` | AvatarBoutique | Profil | Profil |  |
| 12 | `amis` | `app/amis.tsx` | `/amis` | Amis | Profil | Communauté et progression |  |
| 12 | `ami` | `app/ami/[code].tsx` | `/ami/[code]` | Amis | Profil | Communauté et progression | Lien d’invitation kwatt://ami/CODE : propose d’ajouter le joueur en ami. |
| 13 | `parametres` | `app/parametres/index.tsx` | `/parametres` | Parametres | Profil | Comptes | Les réglages vivent dans src/preferences (store persistant) ; la langue se change avec setAppLanguage() (src/i18n). |
| 14 | `modeDames` | `app/(tabs)/jouer/dames.tsx` | `/jouer/dames` | ModeDames | Profil | Dames |  |
| 15 | `machine` | `app/dames/machine.tsx` | `/dames/machine` | DefiMachine | Profil | Dames |  |
| 16, 16b, 43 | `partieDames` | `app/dames/partie/[id].tsx` | `/dames/partie/[id]` | PartieDames, PartieDames8, TabletteDames | Session (invité ou profil) | Dames | 10×10 (16), 8×8 (16b) et mise en page tablette (43) : même route, la variante vient de la partie. Pas de barre du bas. |
| 17 | `affichage` | `app/parametres/affichage.tsx` | `/parametres/affichage` | PleinSoleil | Tout le monde | Dames | Réglage Nuit / Plein soleil / Automatique (src/theme) ; aussi accessible depuis le menu d’une partie. |
| 18 | `resultat` | `app/partie/[id]/resultat.tsx` | `/partie/[id]/resultat` | Resultat | Session (invité ou profil) | Dames | Fin de partie commune aux Dames et au Ludo : revanche (défi) ou joueur suivant (salon). |
| 19 | `revoir` | `app/partie/[id]/revoir.tsx` | `/partie/[id]/revoir` | Revoir | Profil | Dames |  |
| 19b | `probleme` | `app/dames/probleme-du-jour.tsx` | `/dames/probleme-du-jour` | ProblemeDuJour | Profil | Dames |  |
| 20 | `modeLudo` | `app/(tabs)/jouer/ludo.tsx` | `/jouer/ludo` | ModeLudo | Profil | Ludo |  |
| 20b | `ludoVariantes` | `app/ludo/variantes.tsx` | `/ludo/variantes` | LudoVariantes | Profil | Ludo |  |
| 21, 21b, 21c | `partieLudo` | `app/ludo/partie/[id].tsx` | `/ludo/partie/[id]` | PartieLudo, PartieLudo6, LancerCauris | Session (invité ou profil) | Ludo | Croix (21), étoile à 6 (21b) et lancer de cauris du Pachisi (21c) : même route. Pas de barre du bas. |
| 22 | `deHonnete` | `app/partie/[id]/de.tsx` | `/partie/[id]/de` | DeHonnete | Session (invité ou profil) | Parties en ligne |  |
| 23 | `regles` | `app/regles/[jeu].tsx` | `/regles/[jeu]` | Regles | Tout le monde | Ludo | `jeu` : dames, dames8 ou ludo. |
| 24 | `creerSalon` | `app/salon/nouveau.tsx` | `/salon/nouveau` | CreerSalon | Profil | Parties en ligne |  |
| 25 | `salon` | `app/salon/[code].tsx` | `/salon/[code]` | Salon | Session (invité ou profil) | Parties en ligne | Lien kwatt://salon/CODE ; sans session, renvoi vers 02 avec le code. |
| 26 | `mise` | `app/defi/[id].tsx` | `/defi/[id]` | Mise | Profil, 18 ans et plus | Parties en ligne |  |
| 27 | `ligues` | `app/(tabs)/ligues.tsx` | `/ligues` | Ligues | Profil | Ligues |  |
| 28 | `creerLigue` | `app/ligue/nouvelle.tsx` | `/ligue/nouvelle` | CreerLigue | Profil | Ligues |  |
| 28b | `reglesCompetition` | `app/ligue/regles.tsx` | `/ligue/regles` | ReglesCompetition | Profil | Ligues |  |
| 29 | `championnat` | `app/ligue/[id]/index.tsx` | `/ligue/[id]` | Championnat | Session (invité ou profil) | Ligues | Lien kwatt://ligue/CODE (le code d’invitation sert d’identifiant). Une coupe renvoie vers 30. |
| 30 | `coupe` | `app/ligue/[id]/coupe.tsx` | `/ligue/[id]/coupe` | Coupe | Session (invité ou profil) | Ligues |  |
| 31 | `creerLiguePublique` | `app/ligue-publique/nouvelle.tsx` | `/ligue-publique/nouvelle` | CreerLiguePublique | Profil, 18 ans et plus | Ligues |  |
| 32 | `liguePublique` | `app/ligue-publique/[id].tsx` | `/ligue-publique/[id]` | LiguePublique | Profil, 18 ans et plus | Ligues |  |
| 33 | `validerLigue` | `app/ligue/[id]/valider.tsx` | `/ligue/[id]/valider` | ValiderLigue | Profil | Ligues | Réservé au créateur de la ligue : vérifié par l’écran (le serveur fait foi). |
| 34 | `matchDuJour` | `app/ligue/[id]/match/[matchId]/index.tsx` | `/ligue/[id]/match/[matchId]` | MatchDuJour | Profil | Ligues |  |
| 34b | `choixPlanche` | `app/ligue/[id]/match/[matchId]/planche.tsx` | `/ligue/[id]/match/[matchId]/planche` | ChoixPlanche | Profil | Ligues |  |
| 35 | `exclusion` | `app/ligue/[id]/exclusion.tsx` | `/ligue/[id]/exclusion` | Exclusion | Profil | Ligues |  |
| 36 | `quartiers` | `app/quartiers.tsx` | `/quartiers` | Quartiers | Profil | Communauté et progression |  |
| 37 | `regarder` | `app/regarder/[id].tsx` | `/regarder/[id]` | KwattTV | Session (invité ou profil) | Parties en ligne | « Autour du damier » : regarder ne demande pas de profil (session invitée). |
| 38 | `signaler` | `app/signaler/[userId].tsx` | `/signaler/[userId]` | Signaler | Profil | Communauté et progression |  |
| 39 | `cartes` | `app/(tabs)/cartes.tsx` | `/cartes` | Cartes | Profil | Communauté et progression |  |
| 40 | `recompenses` | `app/recompenses.tsx` | `/recompenses` | Recompenses | Profil | Communauté et progression |  |
| 41 | `echelons` | `app/echelons.tsx` | `/echelons` | Echelons | Profil | Communauté et progression |  |
| 42 | `raisonnement` | `app/raisonnement.tsx` | `/raisonnement` | Raisonnement | Profil | Communauté et progression |  |
| — | `reglesQuartier` | `app/legal/regles.tsx` | `/legal/regles` | Inscription | Tout le monde | Comptes | Règles du quartier, acceptées à l’inscription (03) et lisibles depuis les Paramètres (13). Texte : locales/<langue>/legal.json. |
| — | `confidentialite` | `app/legal/confidentialite.tsx` | `/legal/confidentialite` | Inscription | Tout le monde | Comptes | Politique de confidentialité (données gardées, pas de publicité ni d’argent réel, export, suppression à J+30). |
| — | `jouer` | `app/(tabs)/jouer/index.tsx` | `/jouer` | — | Profil | Fondation appli | Rouvre le dernier espace utilisé (Dames par défaut) : redirection, pas d’écran. |
| — | `lienSalon` | `app/s/[code].tsx` | `/s/[code]` | — | Tout le monde | Fondation appli | Lien de partage https://<domaine>/s/CODE : redirige vers /salon/CODE. |
| — | `kit` | `app/kit.tsx` | `/kit` | Main | Tout le monde | Fondation appli | Catalogue du kit de composants (développement, captures) : visible en développement ou avec EXPO_PUBLIC_SHOW_KIT=1, sinon renvoie à l’accueil. |
