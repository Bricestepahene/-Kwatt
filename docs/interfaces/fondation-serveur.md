# Interfaces · fondation-serveur

Rapport de l'équipe à la fin de la vague 1 (référence pour les équipes suivantes ; le code fait foi en cas d'écart).

## API exposées

@kwatt/protocol (zod), fichiers src/errors.ts + src/errors/<module>.ts, src/http/<module>.ts, src/ws/<module>.ts, exportés par src/index.ts :
- Erreurs : ERROR_CODES, type ErrorCode, isErrorCode, ApiErrorSchema / ApiError ({error:{code,params}}), ErrorParams, JsonValue. Pour en ajouter : un fichier errors/<module>.ts (liste `as const`) + une ligne dans ERROR_CODES.
- Commun : LOCALES / LocaleSchema / DEFAULT_LOCALE, UuidSchema, IsoDateSchema, PLATFORMS, DeviceSchema {installId, platform, appVersion?}, PaginationQuerySchema {cursor?, limit 1-100 (20)}, paginated(item) → {items, nextCursor}, OkResponseSchema, HealthResponseSchema.
- Auth (préfixe /v1/auth) : POST register (RegisterRequest → 201 RegisterResponse {…, converted, welcomeBonus}), POST login (LoginRequest {login: pseudo ou e-mail, password, device} → LoginResponse {…, deletionCancelled}), POST guest (GuestRequest → 201 ou 200 GuestResponse {…, created}), POST refresh ({refreshToken, device} → AuthSessionResponse), POST logout, POST logout-all, POST email/verify ({code}), POST email/resend → {resendAvailableAt, expiresAt}, POST password/forgot (202 dans tous les cas), POST password/reset/verify ({email, code} → {resetToken, expiresAt}), POST password/reset ({resetToken, newPassword, device} → AuthSessionResponse), POST password/change, GET pseudo/availability?pseudo= → {pseudo, available, reason: taken|invalid|banned|null, suggestions[3]}. Constantes : PSEUDO_PATTERN, PASSWORD_MIN_LENGTH 8, OTP_* (6 chiffres, 600 s, 5 essais, renvoi 60 s).
- Me : GET /v1/me → MeSchema {id, kind, pseudo, email, emailVerified, locale, ageGroup teen|adult|null, permissions {canStake, canPredict, canJoinPaidLeagues, canCreate, visibleToStrangers}, pseudoChangeAvailableAt, deletionRequestedAt, deletionScheduledFor, settings, createdAt}. PATCH /v1/me/pseudo, PATCH /v1/me/locale, GET et PATCH /v1/me/settings (null retire une clé, 50 clés au plus), POST /v1/me/delete ({password?} → {deletionScheduledFor}), GET /v1/me/export → {format:'kwatt-export', version:1, exportedAt, userId, sections}.
- Portefeuille : GET /v1/wallet → {balance} ; GET /v1/wallet/journal?cursor&limit → {items: JournalEntry {txId, kind, amount, balanceAfter, gameId, meta, createdAt}, nextCursor}. Constantes WELCOME_BONUS = 500 et LEDGER_KINDS.
- Notifications (préfixe /v1/notifications) : GET / → {items, nextCursor, unreadCount} ; POST /read ({ids} ou {all:true}) → {unreadCount} ; GET et PUT /preferences {turn, invites, league} ; POST et DELETE /push-token {token}. Types : kind '<catégorie>.<nom>', notificationCategory(), EXPO_PUSH_TOKEN_PATTERN.
- WebSocket : ClientEnvelopeSchema {t, id?}, ServerEnvelopeSchema {t, re?}, clientMessage(t, shape), serverMessage(t, shape), WsErrorMessageSchema {t:'error', re?, code, params}, WS_CLOSE_CODES {serverShutdown 1001, unauthorized 4401, sessionRevoked 4403, tooManyMessages 4429}, WS_MAX_PAYLOAD_BYTES. Messages : hello {userId, connectionId, serverTime}, ping → pong {serverTime}, presence.update {users:[{userId, online, lastSeenAt}]}, notify {notification, unreadCount}.

@kwatt/server — décorateurs Fastify utilisables dans les modules (src/modules/<nom>/routes.ts, enregistrés par une ligne dans src/modules/index.ts) :
- app.config, app.db (pg.Pool), app.clock, app.mailer.
- Garde-fous de route (preHandler) : app.authenticate, app.requireMember, app.requireAdult, app.requireVerified ; dans le gestionnaire, requireAuth(req) → AuthContext {userId, sessionId, deviceId, kind, locale, ageGroup, verified, pseudo}.
- Temps réel : app.realtime (send, sendError, sendToUser, sendToUsers, broadcast, subscribe, unsubscribe, subscribeUser, unsubscribeUser, publish, isOnline, connectionsOf, sessionIds, onPresenceChange, setPresenceAudience(fn userId → amis), closeSession, closeUser, sweep) et app.registerWsHandler(type, schema, ({msg, conn, userId, log, reply}) => …).
- Notifications : app.notifications.notify(dbOuTransaction, userId, kind, params, {push: 'auto'|'always'|'never'}), avec en plus pushTo, unreadCount, idle, disablePushTokens.
- Tâches et données du compte : app.registerJob(name, everyMs, fn({db, log, now})), app.jobs.runNow(name), app.accounts.onErase(name, (tx, userId) => …), app.accounts.addExportSection(name, (db, userId) => …).
- Médias : app.media.save(relPath, bytes) → URL publique, ainsi que pathOf, urlOf, remove.
- Fonctions exportées par src/index.ts : buildApp, loadConfig, transaction(db, fn, {isolation?}) avec tx.afterCommit(fn), afterCommit, AppError(code, status, params), parse(schema, data), requireAuth, usersShareDevice(db, a, b), sharedDevicePairs(db, ids). Grand livre : transfer(db, {kind, entries:[{wallet:{userId}|{system}|{escrow, gameId?}|{walletId}, amount}], idempotencyKey, gameId?, meta?}) → {txId, replayed, entries}, balanceOf, escrowBalance, findTransfer, resolveWallet. Séquestre : lockStake, lockStakes (tout ou rien), payoutPot(db, gameId, winnerIds, meta), refundStakes(db, gameId, userIds?), gameEscrowKey, grantWelcomeBonus.
- Pagination : lib/cursor.ts (cursorAt, decodeCursor, pageOf).
- Aides de test (src/test/helpers.ts) : buildTestApp({suite, env, listen, extend}) → {app, db, clock: ManualClock, mail: MemoryTransport, push: MemoryPushSender, wsUrl}, createGuest, createMember({verified, birthYear, locale, fromGuest, device}), testDevice, connectWs, TestWsClient.next(t | prédicat), TEST_PASSWORD.
- Autres routes HTTP : GET /v1/health ; GET /v1/ws?token= ; GET /media/* ; GET /s/:code (ouvre kwatt://salon/CODE) et GET /l/:code (kwatt://ligue/CODE) ; /v1/admin/* (stats, users?q=, users/:id/{birth-year, verify-email, revoke-sessions, cancel-deletion, adjust}, jobs/:name/run) avec l'en-tête Authorization: Bearer ADMIN_TOKEN.
- Commandes : pnpm db:migrate ; pnpm --filter @kwatt/server admin <stats|user|verify-email|set-birth-year|adjust|revoke-sessions|cancel-deletion|erase-due|gen-secret> ; en production `./deploy/compose.sh exec api node dist/admin/cli.js …` et `node dist/db/migrate-cli.js`.
- Textes push : clés push.<kind>.title / push.<kind>.body dans apps/server/src/i18n/{fr,en}.json (sinon push.default). Canaux Android attendus : turn, invites, league, default.

## Livré

- REPRISE : le premier passage (a0b6f3b) avait livré le protocole, le squelette Fastify, les migrations 0002–0005, l'auth complète, le grand livre, le temps réel, les notifications, les tâches, les médias, l'admin, l'i18n et les pages de partage. Ce passage a vérifié que tout était vert, puis a corrigé, complété et testé le reste. Aucun push.
- Pagination (lib/cursor.ts) : les curseurs gardent l'heure à la microseconde, via cursorAt(colonne) côté SQL. Avant, le journal des cauris et la liste des notifications pouvaient sauter ou répéter des lignes écrites dans la même milliseconde.
- Invités liés à l'identifiant d'installation. POST /v1/auth/guest reprend l'invité actif de l'appareil (réponse 200, created:false) ou en crée un (201). Une inscription sans jeton convertit l'invité actif de l'appareil, même users.id. Un invité déjà converti, effacé ou en cours de suppression n'est jamais repris.
- Connexion : en plus de la limite par IP, 5 essais par minute et par compte. Alterner pseudo et e-mail du même compte ne double plus le nombre d'essais.
- Temps réel : à l'ouverture de la connexion, le joueur reçoit presence.update avec l'état de ses amis. Toutes les minutes, closeRevokedSockets(app) coupe les WebSocket dont la session a été fermée ailleurs (CLI, autre processus). Ajout de hub.sessionIds().
- Notifications : livrées dans l'ordre de création, avec une file par joueur. notifications.idle() permet d'attendre la fin des livraisons et est appelé à l'arrêt du serveur.
- Script racine `pnpm db:migrate` (passe par @kwatt/server). La CI le lance deux fois sur une base vide (le second passage ne fait rien), à la place de la boucle psql, et construit l'image de l'API dans un job « image ».
- Nouveaux tests : economy.test.ts (21), me.test.ts (11), realtime.test.ts (18), notifications.test.ts (15), jobs.test.ts (6), share, media et admin, plus des ajouts dans auth et app. Couvert notamment : concurrence (retraits simultanés jamais sous zéro, transferts croisés sans interblocage, même clé envoyée en parallèle), idempotence, séquestre (tout ou rien, pot versé une seule fois), effacement à J+30, export, ping et connexion morte, verrou consultatif entre deux serveurs.
- Bases de test : si PostgreSQL occupe la base un instant, sa suppression est réessayée (elle échouait de temps en temps avec « permission denied to terminate process »).
- apps/server/Dockerfile : image en plusieurs étapes (dépendances du seul serveur, tsc -b, pnpm deploy --prod --legacy, migrations copiées dans /app/migrations), utilisateur node, sonde de santé. Les fichiers ignorés sont dans apps/server/Dockerfile.dockerignore, pour ne pas gêner les autres images.
- deploy/docker-compose.prod.yml : caddy (HTTPS automatique sur DOMAIN), api (migrations au démarrage, volume media), ludo-ai (construit depuis services/ludo-ai/Dockerfile, sans le .env complet), postgres 16 avec volume, backup (pg_dump chaque nuit, gardé 14 jours).
- Fichiers de déploiement : deploy/Caddyfile ; deploy/backup.sh (loop, now, list, restore — la base actuelle est renommée et remise en place si la restauration échoue) ; deploy/compose.sh (raccourci qui passe --env-file .env) ; deploy/backups/.gitignore.
- docker-compose.yml de développement : PostgreSQL seul, sans Redis (D-02) ; le schéma vient de `pnpm db:migrate` et non plus de docker-entrypoint-initdb.d.
- Documentation : .env.example complet et commenté (développement et production, variables [prod] signalées) ; docs/DEPLOIEMENT.md pas à pas en français (VPS Ubuntu, DNS, pare-feu, Docker, .env, premier lancement, migrations, e-mails, sauvegardes et restauration, copie hors site, mises à jour et retour arrière, PHOTO_AUTO_APPROVE, journaux, CLI, dépannage) ; README : section Démarrer corrigée (sans Redis, avec pnpm db:migrate).

## Reste à faire / fragile

- Pile de production complète pas lancée en local : Docker Hub et le miroir ECR ont refusé de fournir l'image postgres:16 (429, limite de données). Ce qui a été vérifié : l'image de l'API se construit (avec un Dockerfile dérivé qui ajoute seulement le certificat du proxy du bac à sable), le conteneur démarre « healthy », applique les migrations, la CLI admin et migrate-cli tournent, et il s'arrête proprement sur SIGTERM (code 0). Le Caddyfile est validé par `caddy validate` et les deux fichiers compose par `docker compose config`. Reste à faire : un vrai `./deploy/compose.sh up -d --build` sur un VPS.
- Le service ludo-ai du compose attend services/ludo-ai/Dockerfile, que l'équipe moteur Ludo doit écrire. Contexte de construction : la racine du dépôt. Le service écoute sur le port 8090 (LUDO_AI_PORT) et l'API l'appelle à http://ludo-ai:8090. En attendant : `./deploy/compose.sh up -d --build caddy api postgres backup`.
- Le job CI « image » (docker build) n'a pas encore tourné sur GitHub.
- La documentation suppose que la copie hors site des sauvegardes (rsync ou rclone) et celle du volume des photos (kwatt_media) sont mises en place à la main.
- Les préférences de notification ne coupent que le push : la notification reste toujours dans la liste de l'appli.
- notify garde la signature notify(db, userId, kind, params, options?), avec la transaction en premier, et non notify(userId, kind, params).
- Le plafond de mise et les limites de table (§7) ne sont pas dans ce périmètre (équipes Domaine et Parties) ; seuls les outils sont fournis : usersShareDevice, sharedDevicePairs et le séquestre.

## Décisions

- Invité = compte lié à l'identifiant d'installation (planche Système : « jeton temporaire lié à l'appareil »). /auth/guest reprend l'invité actif de l'appareil, et une inscription sans jeton le convertit. Contrepartie acceptée : connaître l'installId d'un appareil suffit pour reprendre son invité, qui n'a ni cauris ni données sensibles.
- Pagination : curseur = (horodatage ISO à la microseconde, id), lu en SQL avec to_char … AT TIME ZONE 'UTC'.
- Migrations appliquées à chaque démarrage de l'API en production (MIGRATE_ON_START="true" écrit en dur dans le compose ; un verrou consultatif empêche deux passages simultanés). Toujours possible à la main : `node dist/db/migrate-cli.js`.
- Restauration : la base est d'abord renommée <db>_avant_<date> (jamais supprimée), puis restaurée dans une base neuve ; en cas d'échec, l'ancienne est remise en place. C'est plus sûr que pg_restore --clean, et vérifié : les déclencheurs du grand livre (post-data) ne bloquent pas la restauration des soldes.
- Caddy sans journal d'accès, parce que l'URL /v1/ws?token= porte le jeton ; l'API journalise chaque requête avec le jeton masqué.
- ACME_EMAIL obligatoire : une directive `email` vide rend le Caddyfile invalide. Pas de bloc www. pour ne pas réclamer un certificat sans DNS.
- Le service ludo-ai ne reçoit pas le .env (aucun secret de l'API) : seulement NODE_ENV et LUDO_AI_PORT.
- Secrets générés en hexadécimal (openssl rand -hex …), pour éviter les soucis de guillemets et de `$` dans les fichiers env de compose et dans DATABASE_URL.
- Docker : fichier d'exclusions propre au Dockerfile du serveur (apps/server/Dockerfile.dockerignore) plutôt qu'un .dockerignore racine partagé.
- Sauvegarde quotidienne à 2 h UTC (3 h à Douala) par défaut, gardée 14 jours, dans deploy/backups (réglable par BACKUP_DIR, BACKUP_KEEP_DAYS, BACKUP_HOUR_UTC).
- README (fichier partagé) : seules les lignes du bloc Démarrer ont été modifiées (Redis retiré, pnpm db:migrate ajouté, lien vers DEPLOIEMENT.md), pour limiter les conflits avec l'autre équipe.
- Le CLAUDE.md demande des messages de commit en français : ils le sont, avec le pied Co-Authored-By plus la ligne Claude-Session de l'attribution.
