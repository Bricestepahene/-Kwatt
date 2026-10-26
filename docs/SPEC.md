# Kwatt · cahier des charges de réalisation (V1 complète)

Ce document est le **contrat commun** de toutes les personnes et de tous les agents qui écrivent du code Kwatt.
Ordre de priorité en cas de conflit : 1) consignes de l'utilisateur, 2) ce document, 3) planches de la maquette (`docs/maquette/*.dc.html`, voir `docs/maquette/README.md`), 4) `docs/proposition-v1.md`.
L'utilisateur a délégué tous les arbitrages : les décisions ci-dessous sont **tranchées**, on ne les rediscute pas dans le code. Une décision nouvelle se consigne ici (section 12), avec sa raison.

---

## 1. Ce qu'on livre

Une appli Expo unique (Android + iOS, et le web pour la vérification) + un serveur Node qui fait foi + un moteur Ludo séparé + PostgreSQL, déployables sur un VPS par `docker compose`, et une appli installable par **expo.dev** (Expo Go pour tester tout de suite, EAS Build pour les fichiers d'installation).

**Tous les écrans de la maquette** (01 à 43, plus 16b, 19b, 20b, 21b, 21c, 28b, 34b) sont livrés et branchés sur de vraies données. Rien n'est « factice » dans la version livrée : les données d'exemple des planches servent seulement de modèle visuel.

---

## 2. Pile technique (versions figées)

| Couche | Choix |
|---|---|
| Appli | **Expo SDK 58**, `expo-router` (routes par fichiers), React Native 0.88, TypeScript strict |
| Dessin des plateaux, tissus, avatars | **`react-native-svg`** (compatible Expo Go et web) — voir D-01 |
| État | `zustand` (état local), `@tanstack/react-query` (données serveur) |
| Stockage appareil | `expo-secure-store` (jetons), `@react-native-async-storage/async-storage` (préférences, file hors ligne) |
| Langues | `i18next` + `react-i18next` + `expo-localization` |
| Polices | `@expo-google-fonts/unbounded`, `@expo-google-fonts/dm-sans` |
| Médias | `expo-image-picker`, `expo-image-manipulator`, `expo-audio`, `expo-haptics` |
| Notifications | `expo-notifications` (push Expo) + liste dans l'appli |
| Capteur de lumière | `expo-sensors` (`LightSensor`, Android) pour « Plein soleil automatique » |
| Serveur | Node 22, **Fastify 5**, `@fastify/websocket`, `@fastify/multipart`, `@fastify/rate-limit`, `@fastify/cors`, `@fastify/helmet` |
| Base | PostgreSQL 16, accès par `pg` en SQL écrit à la main (pas d'ORM), migrations SQL numérotées |
| Mots de passe | `@node-rs/argon2` (argon2id) |
| Jetons | `jose` (JWT HS256) |
| E-mail | `nodemailer` (SMTP) ; en développement, les codes sont écrits dans le journal |
| Images | `sharp` (photos redimensionnées en 512×512 WebP) |
| Validation partagée | `zod` (paquet `@kwatt/protocol`) |
| Tests | `vitest` (paquets et serveur, base PostgreSQL réelle), Playwright (captures de l'export web) |

Aucun module natif hors Expo SDK : l'appli doit tourner dans **Expo Go**.

---

## 3. Organisation du code et propriétaires

```
packages/
  design/        jetons (existe)                         · propriétaire : fondation appli
  rules-dames/   règles (existe)                         · moteur dames
  rules-ludo/    règles (existe) + Parchís, Pachisi, règles maison · moteur ludo
  fair-dice/     dé vérifiable (existe) + lancer de cauris · moteur ludo
  protocol/      schémas zod REST + WebSocket, codes d'erreur · fondation serveur (les autres ajoutent leur fichier)
  domain/        calculs purs : force (Elo), niveaux/échelons, cotes, économie, ligues, quartiers · domaine
  engine-dames/  IA des dames (alpha-bêta, niveaux, problèmes) · moteur dames
  ludo-ai/       IA du Ludo (agents) — pure, utilisée par le service ET l'appli (hors ligne) · moteur ludo
services/
  ludo-ai/       service HTTP qui expose @kwatt/ludo-ai · moteur ludo
apps/
  server/        API + temps réel · fondation serveur, puis un module par fonctionnalité
  mobile/        appli Expo · fondation appli, puis un dossier par fonctionnalité
research/ludo/   Python : simulation, évaluation (hors production) · moteur ludo
db/migrations/   SQL numéroté (plages réservées, §8)
deploy/          Caddy, sauvegardes, scripts · fondation serveur
docs/            SPEC, maquette, déploiement
```

Règles de cohabitation :
- Chacun écrit **dans son dossier**. Les fichiers partagés (index d'exports, registre des modules, `package.json` racine) se modifient par ajout de lignes, jamais par réécriture.
- Les migrations d'une fonctionnalité vont dans **sa plage de numéros** (§8) ; on ne modifie jamais une migration déjà livrée, on en ajoute une (`ALTER TABLE`).
- Serveur : un module = `apps/server/src/modules/<nom>/` avec `routes.ts` (plugin Fastify), `service.ts`, `*.test.ts`, et éventuellement `ws.ts` (gestionnaires de messages temps réel). Enregistrement dans `apps/server/src/modules/index.ts`.
- Appli : un écran = un fichier de route dans `apps/mobile/app/` ; la logique dans `apps/mobile/src/features/<nom>/` ; les traductions dans `apps/mobile/src/i18n/locales/{fr,en}/<nom>.json`.

---

## 4. Langues : chacun la sienne, dans la même partie

- Langues : **français** (`fr`, par défaut) et **anglais** (`en`). Langue initiale = langue de l'appareil si `fr` ou `en`, sinon `fr`. Modifiable dans Paramètres, enregistrée dans le profil (`profiles.locale`) et sur l'appareil (invités).
- **Le serveur n'envoie jamais de phrase affichable** à l'appli : uniquement des codes et des paramètres (`{ code: 'room.full' }`, `{ t: 'game.event', kind: 'capture', params: { count: 3 } }`). Chaque appli traduit dans la langue de **son** joueur. Deux amis jouent ensemble, l'un en français, l'autre en anglais.
- Les réactions rapides (« chambrer », réactions des spectateurs) sont des **clés** (`reaction.ekie`, `reaction.doucement`, `reaction.tu_dors`, `reaction.weee`, `reaction.bravo`, `reaction.revanche`) traduites chez chaque joueur. Les interjections camerounaises restent telles quelles dans les deux langues (« Ékié ! », « Wèèè »), le reste est traduit.
- Seuls textes rendus par le serveur : **e-mails** et **notifications push**, rendus dans la langue du destinataire (`apps/server/src/i18n/{fr,en}.json`).
- Contenu saisi par les joueurs (pseudo, nom de salon, de ligue) : jamais traduit.
- Formats : nombres, dates, heures avec `Intl` selon la langue (« 2 450 » en fr, « 2,450 » en en). Fuseau : celui de l'appareil ; le serveur stocke en UTC.
- Un test vérifie que les catalogues `fr` et `en` ont **exactement les mêmes clés** (appli et serveur).
- Vocabulaire anglais fixé : cauris → *cowries* ; échelons → *ranks* : Apprenti/*Apprentice*, Débrouillard/*Hustler*, Ancien du kwatt/*Kwatt Elder*, Notable/*Notable*, Chef/*Chief*, Fon/*Fon* ; Roi de la table → *King of the table* ; ligue → *league* ; salon → *room* ; Plein soleil → *Full sun* ; Guerre des quartiers → *Neighbourhood war* ; « kwatt » reste « kwatt ».

---

## 5. Thèmes et design

- Trois réglages d'affichage : **Nuit** (défaut), **Plein soleil** (clair, écran 17), **Automatique** (Plein soleil si le capteur de lumière dépasse 10 000 lux pendant 3 s — Android ; sur iOS et le web, suit le mode clair/sombre du système). Réglage dans Paramètres et dans le menu d'une partie.
- Couleurs uniquement depuis `@kwatt/design` (`night`, `pleinSoleil`), polices Unbounded (titres, chiffres) et DM Sans (texte), tissus ndop, toghu, kaba, obom dessinés en SVG.
- Respect de `prefers-reduced-motion` / « réduire les animations » du système, taille de police du système (avec plafond ×1,4 sur les plateaux), lecteurs d'écran (`accessibilityLabel` sur tous les boutons-icônes, cases et pions annoncés : « case 28, pion blanc »).
- Zones tactiles ≥ 48 px, cases de damier ≥ 34 px (le plateau prend le plus grand carré possible), toucher le pion puis la case (glisser possible, jamais obligatoire), abandon loin du pouce et confirmé.
- Tablette (largeur ≥ 900 px) : rail à gauche, plateau au centre, panneau à droite (écran 43). Téléphone 360 px : une colonne, texte ≥ 14 px.
- Sons : balafon (déplacer), tam-tam (prise), nkul (ton tour), mvet (victoire, dame) — sons **synthétisés par script** dans le dépôt (pas de fichiers sous licence). Réglage : Balafon par défaut / Tam-tam / Silence, volume, vibration à la prise.

---

## 6. Comptes, invités, sécurité

- **Connexion V1 : e-mail + mot de passe** (D-05). Inscription : pseudo, e-mail, mot de passe (≥ 8 caractères, indicateur de solidité), année de naissance, acceptation des règles du quartier et de la politique de confidentialité, puis **code à 6 chiffres** envoyé par e-mail (10 min, 5 essais) pour vérifier l'adresse. On peut jouer avant de vérifier ; la vérification est exigée pour miser et pour récupérer un compte.
- **Mot de passe oublié** : code à 6 chiffres par e-mail, 10 min, 5 essais, puis nouveau mot de passe ; toutes les sessions sont fermées. Renvoi possible après 60 s (écran 06).
- **Jetons** : accès JWT 15 min ; renouvellement opaque 30 jours, haché en base, **tournant** (réutilisation d'un ancien jeton = toutes les sessions de l'appareil fermées). Stockés dans `expo-secure-store`.
- **Invité** : `POST /v1/auth/guest` avec l'identifiant d'installation → compte `guest` + jetons. Un invité rejoint un salon par code, regarde une partie, entre dans une ligue privée **gratuite** ; pas de mise, pas de création. À l'inscription depuis l'appareil, le compte invité est **converti** (même `users.id`) : ses parties sont gardées.
- **Âge** (écran 04) : < 13 ans → pas de profil (invité seulement) ; 13–17 → compte jeune (pas de mise, pas de pronostic, pas de ligue payante, invisible des inconnus : recherche par pseudo désactivée, seuls les amis l'invitent) ; ≥ 18 → compte complet. L'année n'est jamais affichée. Changement d'année impossible depuis l'appli (support).
- **Pseudo** : 3 à 20 caractères `[a-zA-Z0-9_.]`, unique sans tenir compte de la casse, liste de mots interdits, modifiable une fois tous les 30 jours. Pris → 3 propositions.
- **Appareils** : chaque installation a un identifiant (`devices`). Deux comptes vus sur le même appareil ne peuvent **jamais** miser l'un contre l'autre (ni être dans la même table avec mise).
- **Suppression du compte** : demande → déconnexion, profil masqué, effacement définitif à J+30 (tâche planifiée), annulable en se reconnectant avant. **Export** de ses données (JSON : profil, parties, journal des cauris) depuis Paramètres.
- **Sauvegarde** : tout est sur le serveur (« Synchronisé il y a 2 min ») ; changement de téléphone = reconnexion. Côté VPS, sauvegarde PostgreSQL quotidienne (14 jours gardés) + copie hors site documentée.
- Protection : limitation de débit sur l'authentification (5 essais/min/IP et par compte), mots de passe en argon2id, pas de fuite d'existence de compte sur « mot de passe oublié », en-têtes de sécurité, CORS restreint, validation zod de toute entrée.

---

## 7. Économie des cauris (chiffres de la maquette)

Pas d'argent réel : les cauris ne s'achètent pas et ne se retirent pas. Aucune publicité.

| Mouvement | Montant |
|---|---|
| Bonus de bienvenue (profil créé, une fois par personne) | **+500** |
| Participation à une partie classée terminée (machine ou joueurs) | **+10** |
| Victoire contre la machine, sans pari | Facile/Moyen **+25**, Coriace **+40**, Ton niveau **+60**, Fon **+100** |
| Série de 3 victoires contre la machine | prochain gain ×1,5 |
| Parties contre la machine récompensées | **10 par jour** et par jeu (au-delà : 0) |
| Pari contre la machine | gain = base + mise × (cote − 1) ; perte = − mise (+10 de participation) ; **cote = 0,9 ÷ p** |
| Problème du jour résolu | **+10** ; série de 7 jours : carte rare au choix |
| Quêtes de la semaine | montants de l'écran 40 (+50, +80, carte rare) |
| Mise entre joueurs | les mises sont bloquées sur un compte séquestre ; le gagnant prend le pot ; nul (Dames) = chacun récupère sa mise |
| Plafond de mise | **min(25 % du plus petit solde des joueurs qui misent, limite de la table)** |
| Limite de la table selon l'échelon le plus bas des joueurs | Apprenti 50 · Débrouillard 100 · Ancien 200 · Notable 500 (« Table du Wouri ») · Chef 2 000 (« Table du Mont Cameroun ») · Fon 5 000 (« Trône du Fon ») |
| Ligues | droits d'entrée, caution, pot, partage : planche « Réf · Ligue publique » à la lettre |
| Pronostics (spectateurs ≥ 18 ans) | 50 cauris, pari mutuel entre spectateurs, fermés au coup 10 (Dames) ou au tour 10 (Ludo) ; si tout le monde a parié du même côté, remboursement |
| Boutique | prix des écrans 10, 11, 39 |

- Chances de gagner : `p = 1 / (1 + 10^((force adverse − ta force) / 400))`.
- Toute écriture passe par le **grand livre** (`@kwatt/server` `ledger` : `transfer({kind, entries, idempotencyKey, gameId?})`), jamais par un `UPDATE` direct.
- **Hors connexion** (contre la machine, Dames et Ludo) : pas de pari, gains de base seulement, envoyés au retour du réseau et **revalidés** par le serveur (rejeu des coups), dans la limite des 10 parties du jour.

### Force, niveaux, échelons
- Force façon Elo **par variante classée** (`dames10`, `dames8`, `ludo_classique`, `ludo_rapide`, `ludo_six`). Départ : **900**. K = 32 pour les 30 premières parties, puis 20. Ludo à n joueurs : duels deux à deux selon les places, K ÷ (n − 1).
- **Niveau** = max(1, ⌊(force − 800) ÷ 40⌋) (Niv 18 à 1 520, cohérent avec les écrans 09 et 18).
- **Échelons** : Apprenti 1–4, Débrouillard 5–9, Ancien du kwatt 10–14, Notable 15–19, Chef 20–24, Fon 25+.
- Contre la machine (écran 15), **5 difficultés** relatives à ta force : Facile (p ≈ 0,9), Moyen (0,75), Coriace (0,6), **Ton niveau** (0,5, affiché avec le nom de ton échelon), Fon (0,2 ; débloqué à l'échelon Chef). Force de la machine = ta force − 400 × log10(p ÷ (1 − p)).
- **Difficulté auto** (écran 14) : la machine monte d'un cran après 3 victoires de suite, baisse d'un cran après 3 défaites de suite.
- Mesure : objectif 45–55 % de victoires à ton niveau, suivi par variante (statistiques serveur).

---

## 8. Base de données

- `db/migrations/0001_init.sql` existe. Exécution par `pnpm db:migrate` (table `schema_migrations`, chaque fichier dans une transaction).
- Plages réservées : `0002–0009` fondation serveur · `0010–0019` comptes · `0020–0029` profil, avatars, boutique · `0030–0039` dames et machine · `0040–0049` salons et parties en ligne · `0050–0059` Ludo · `0060–0069` ligues · `0070–0079` communauté et progression · `0080–0089` intégration.
- Tests : chaque suite crée sa propre base (`kwatt_test_<module>_<pid>`) et applique toutes les migrations.

---

## 9. API et temps réel

### REST
- Préfixe `/v1`. JSON. Erreur = HTTP 4xx/5xx + `{ "error": { "code": "auth.invalid_credentials", "params": {} } }`. Les codes sont listés dans `@kwatt/protocol` (`ErrorCode`) et traduits par l'appli.
- Authentification : `Authorization: Bearer <jeton d'accès>`. Décorateurs Fastify : `app.authenticate` (invité ou profil), `app.requireMember` (profil), `app.requireAdult` (≥ 18 ans).
- Pagination : `?cursor=…&limit=…` → `{ items, nextCursor }`.

### WebSocket
- Une connexion par appli : `GET /v1/ws?token=<jeton d'accès>`.
- Enveloppe : client → serveur `{ t: string, id?: string, ...données }` ; serveur → client `{ t: string, re?: string, ...données }` (`re` = `id` du message auquel on répond). Erreur : `{ t: 'error', re, code, params }`.
- Messages de base (fondation) : `ping`/`pong`, `presence.update` (amis en ligne), `notify` (nouvelle notification).
- Chaque module enregistre ses types de messages (`registerWsHandler('room.join', schema, handler)`). Les schémas sont dans `@kwatt/protocol` (`src/ws/<module>.ts`).
- **État faisant foi** : pour une partie, le serveur envoie `game.state` (état complet + `seq` croissant) après chaque événement, plus `game.event` pour les animations et les sons. L'appli affiche toujours le dernier `game.state` ; à la reconnexion, elle redemande `game.sync`.

### Contrôleur de partie (appli)
Les écrans de partie (16, 16b, 21, 21b, 21c, 43) ne savent pas d'où vient la partie. Ils reçoivent un **contrôleur** :
```ts
interface GameController<State, Move> {
  readonly kind: 'local' | 'remote';
  getState(): State;                 // dernier état faisant foi
  subscribe(cb: (s: State, e?: GameEvent) => void): () => void;
  mySeats(): number[];               // sièges joués par cet appareil
  legalMoves(): Move[];              // calculés par @kwatt/rules-*
  play(move: Move): void;            // local : applique ; distant : envoie game.move
  roll?(): void;                     // Ludo
  resign(): void;
  offerDraw?(): void; answerDraw?(accept: boolean): void;  // Dames
  react?(key: string): void;
  clock(): { [seat: number]: { remainingMs: number; running: boolean } } | null;
}
```
- `local` : machine hors ligne (Dames, Ludo) — moteurs dans l'appli.
- `remote` : salons, ligues, machine en ligne (pari), regarder une partie.

---

## 10. Règles de jeu tranchées

### Dames
- 10×10 internationales et 8×8 anglaises : `@kwatt/rules-dames` (existe, testé).
- Nulles : répétition 3 fois ; 25 coups de dames de chaque côté sans prise ni pion joué (10×10) ; 40 coups de chaque côté (8×8). Règles de fin de partie « 16 coups » FMJD non appliquées en V1 (seuils à valider avec la fédération, planche Compétitions).
- Pendules en salon : 3 min + 2 s, **5 min + 3 s (défaut)**, 10 min + 5 s, 15 min + 10 s. Contre la machine : sans pendule.
- 8×8 en tournoi : ouverture des 3 premiers coups tirée au sort parmi une liste (via le tirage vérifiable).
- Proposer la nulle : 1 fois tous les 10 coups au plus. Abandon confirmé.
- Coupure réseau : pendule arrêtée, 60 s pour revenir, puis défaite (contre la machine en ligne : on reprend plus tard).

### Ludo
- Classique (croix, 2–4), 6 joueurs (étoile, 2–6, et automatiquement dès 5), Rapide (croix, 2 pions, 10 min, puis classement à la progression), Parchís (68 cases, 12 sûres, barrières, sortie au 5, capture + 20, trois 6 = pion renvoyé), Pachisi (6 cauris, équipes 2 contre 2 obligatoires, 12 châteaux, grâces 6/10/25). Planche « Réf · Variantes » à la lettre, combinaisons bloquées refusées.
- Classées (force, ligues publiques, mises) : Classique, Rapide, 6 joueurs. Parchís, Pachisi et règles maison : amicales.
- **30 s par tour** ; temps écoulé → la machine joue ce tour à ta place. Déconnecté **plus de 60 s** → tu sors de la partie (pions retirés, dernier, mise perdue). Coup unique → joué tout seul (réglage, activé par défaut).
- Équipes : partenaires face à face, on ne mange jamais son partenaire ; classement d'équipe = somme des places.
- Règles maison : sortie, capture, protection, barrières modifiables dans les limites de la planche ; jeux de règles enregistrés et nommés (« les règles de Tata Odile »).

### Salons (écrans 24 à 26)
- Code de 6 caractères (sans 0/O/1/I), affiché `ABC-DEF`, lien `kwatt://salon/ABCDEF` et `https://<domaine>/s/ABCDEF`.
- Formats : partie simple · aller-retour (couleurs échangées / places tournées) · **roi de la table** (le perdant passe en fin de file, le gagnant reste ; au Ludo, le dernier sort).
- Hôte parti → le plus ancien devient hôte. Place gardée 60 s. Salon fermé après 30 min sans partie.
- Mise : profils ≥ 18 ans seulement ; un invité joue sur une place sans mise (le pot ne compte que les joueurs qui misent).

---

## 11. Plan de réalisation (agents)

| Vague | Équipe | Contenu |
|---|---|---|
| 1 | Fondation serveur | `@kwatt/protocol`, squelette Fastify, migrations, authentification complète (§6), grand livre, temps réel de base, notifications (service), i18n serveur, Docker, déploiement |
| 1 | Fondation appli | Expo, navigation complète (toutes les routes), thème, langues, polices, composants, tissus, sons, clients REST et WebSocket, stockage, EAS |
| 1 | Domaine + moteur dames | `@kwatt/domain`, `@kwatt/engine-dames` |
| 1 | Moteur Ludo | Parchís, Pachisi, règles maison, cauris vérifiables, `@kwatt/ludo-ai`, service, banc d'essai Python |
| 2 | Comptes | écrans 01–06, 13 |
| 2 | Profil | écrans 09–11 |
| 2 | Dames | écrans 14–19b, 43 (hors ligne et rendu des parties) |
| 2 | Ludo | écrans 20–23 (rendu, hors ligne) |
| 2 | Parties en ligne | salons, mises, machine en ligne, spectateurs, pronostics, dé vérifiable (24–26, 37, 22) |
| 2 | Ligues | écrans 27–35, 28b, 34b |
| 2 | Communauté et progression | 07, 08, 12, 36, 38–42 |
| 3 | Intégration et vérification | tests de bout en bout, captures FR/EN de tous les écrans, revue design, sécurité, règles |

---

## 12. Journal des décisions

| # | Décision | Raison |
|---|---|---|
| D-01 | Plateaux, tissus et avatars en **`react-native-svg`** et non Skia | Fonctionne dans Expo Go et sur le web (vérification par captures) ; les plateaux sont statiques, SVG suffit. |
| D-02 | **Pas de Redis en V1** : un seul processus serveur, parties en mémoire, chaque coup écrit en base, reprise au redémarrage par rejeu | Échelle d'un groupe d'amis ; une pièce de moins à déployer. Le protocole permet d'ajouter Redis plus tard. |
| D-03 | Langue par joueur, le serveur n'envoie que des codes | Exigence : un joueur en français, l'autre en anglais, dans la même partie. |
| D-04 | Thème Automatique = capteur de lumière (Android) sinon thème système | Écran 13 « Plein soleil automatique ». |
| D-05 | Connexion V1 par e-mail seulement | Réponse de l'utilisateur ; conforme aux règles Apple (pas de connexion sociale proposée). |
| D-06 | Force de départ 900, niveau = ⌊(force − 800) ÷ 40⌋ | Cohérent avec les écrans 09 (Niv 17 à 1 482, Niv 18 à 1 520) et la planche Moteur. |
| D-07 | Limites de table par échelon (§7) | La maquette cite 100 (Débrouillard) et 500 (Table du Wouri) ; les autres valeurs prolongent la progression. |
| D-08 | Hors ligne : pas de pari, gains de base revalidés au retour | Le serveur ne peut pas garantir une machine jouée sur le téléphone. |
| D-09 | Pronostics à 50 cauris en pari mutuel, fermés au coup/tour 10 | Écran 37 (« 50 cauris »), sans avantage d'information. |
| D-10 | Photos de profil modérées ; `PHOTO_AUTO_APPROVE=true` possible pour un déploiement entre amis | Matrice : « modérée avant affichage » ; un petit groupe n'a pas de modérateur. |
| D-11 | Quartier choisi au premier lancement (liste par ville, villes du Cameroun et diaspora), changeable une fois par saison ; saison = mois civil | Écrans 05 et 36. |
| D-12 | Pas de règles FMJD « 16 coups » en V1 | Planche Compétitions : seuils à valider avec la fédération. |
| D-13 | Sons synthétisés par script | Pas de droits à gérer ; poids minimal. |
| D-14 | Les cartes « pouvoir » sont des commodités (revanche immédiate…), jamais un avantage de jeu | Équité. |
| D-15 | Compétitions par équipes : championnat privé seulement (2 à 16 équipes), planche imposée ou une par journée, heure de la ligue (pas d'heure proposée) | Une rencontre d'équipes se joue à une heure et sur une planche connues de tous. |
| D-16 | Équipes incomplètes au lancement dissoutes et remboursées ; ordre non déposé = ordre de l'équipe (capitaine d'abord) ; pas d'exclusion en ligue par équipes (le forfait perd la planche, l'amende reste) | Pas de forfait d'équipe pour un oubli ; l'équipe porte ses absents. |
| D-17 | Cagnotte d'une ligue par équipes : parts égales entre les joueurs de l'équipe championne, le reste au capitaine ; médailles pour chaque joueur des trois premières équipes | Planche RegleCompet ; aucun choix laissé au capitaine sur l'argent. |
