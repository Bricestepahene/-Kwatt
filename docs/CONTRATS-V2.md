# Contrats entre équipes · vague 2

Les équipes de la vague 2 travaillent en parallèle dans des copies séparées. Ces contrats fixent ce que chacune **fournit** et ce qu'elle **consomme**. Celle qui fournit implémente exactement ce qui est écrit ; celle qui consomme code contre ce contrat, même si l'autre côté n'existe pas encore dans sa copie (elle gère alors l'erreur proprement). L'intégration vérifie que les deux côtés se rejoignent.

Schémas zod dans `@kwatt/protocol` : le fournisseur les écrit dans `packages/protocol/src/http/<module>.ts` / `ws/<module>.ts`. Si le consommateur passe avant, il écrit le schéma **exactement** comme ci-dessous dans ce même fichier (l'intégration fusionnera les deux copies, identiques).

---

## C1 · Force (fournisseur : Dames)

Module serveur `apps/server/src/modules/ratings/` :
```ts
recordRatedResult(tx, {
  gameId: string,
  variant: RatedVariant,                 // dames10 | dames8 | ludo_classique | ludo_rapide | ludo_six
  participants: { userId: string | null; machineRating?: number; place: number }[],  // place 1 = gagnant ; nulle = mêmes places
}) => Promise<Record<string /* userId */, { before: number; after: number; delta: number; levelBefore: number; levelAfter: number }>>
```
- Met à jour `player_ratings` (création à 900 au premier passage) et `rating_history`, avec `@kwatt/domain` (`rateDuel`, `rateMultiplayer`, `levelFromRating`, `rankForRating`). Une machine n'a pas de ligne : sa force sert d'adversaire. Idempotent par `(gameId, userId)`.
- `GET /v1/ratings/me` → `{ items: [{ variant, rating, level, rank, gamesPlayed, wins, draws, losses, pointsToNextLevel }] }`.

## C2 · Machine : offres, gains, résultats hors connexion (fournisseur : Dames ; consommateurs : Ludo, Parties en ligne)

Module serveur `apps/server/src/modules/machine/` :
- `GET /v1/machine/offers?family=dames|ludo&variant=…&machines=1..3` → `{ rating, rank, difficulties: [{ id, p, odds, oddsHundredths, baseReward, unlocked, machineRating }], auto: { difficulty, streak }, winStreak, rewardedToday, dailyLimit: 10, betCap }`.
- `POST /v1/machine/results` (hors connexion, rejouable, idempotent par `clientGameId`) :
  ```ts
  { clientGameId: string, family: 'dames'|'ludo', variant, difficulty, mode: 'auto'|'chosen',
    machines?: number,              // Ludo : 1 à 3
    seed: number,                   // graine de la machine (déterminisme)
    moves: string[],                // Dames : notation officielle ; Ludo : "roll:token" ou "roll:-" (pas de coup)
    playedAt: string }              // ISO
  → { outcome: 'win'|'loss'|'draw', settlement: { net, base, participation, betNet, streakBonus, counted },
      rating: { before, after, delta, levelBefore, levelAfter } | null, auto: { difficulty, streak }, winStreak }
  ```
  Le serveur **rejoue** la partie avec `@kwatt/rules-*` (Dames : il recalcule aussi chaque coup de la machine avec `chooseMoveSync` et la même graine ; Ludo : légalité seulement, les dés hors ligne venant du téléphone). Partie illégale → `machine.invalid_game`. Pas de pari hors connexion. Gains via le grand livre, limite de 10 par jour et par jeu (`daily_rewards`), série et difficulté auto mises à jour, force mise à jour via C1 (adversaire = force de la machine).
- Fonction exportée pour les parties en ligne : `settleMachineOnline(tx, { userId, gameId, family, variant, difficulty, mode, bet, outcome })` → même réponse que ci-dessus (pari compris, à partir de la mise déjà bloquée sur le séquestre de la partie).

## C3 · Parties en ligne (fournisseur : Parties en ligne ; consommateurs : Dames, Ludo, Ligues, Communauté)

- `POST /v1/games/machine` `{ family, variant, difficulty, mode, bet, machines? }` → `{ gameId }` : partie contre la machine **sur le serveur** (obligatoire avec un pari), machine jouée par `@kwatt/engine-dames` (serveur) ou le service `ludo-ai`, dés tirés par `@kwatt/fair-dice`.
- `GET /v1/games/:id` → résumé et rejeu :
  ```ts
  { id, family, variant, context: 'machine'|'room'|'league', status: 'waiting'|'playing'|'finished'|'aborted',
    seats: [{ seat, userId, pseudo, avatar, machine?: { difficulty }, team? }],
    moves: string[],                // même format que C2
    outcome: { places: Record<seat, number>, draw: boolean, reason } | null,
    stake: number, pot: number,
    ratingChanges: Record<userId, { before, after, delta, levelBefore, levelAfter }>,
    settlement?: { net, base, participation, betNet, streakBonus, counted },
    room?: { code, format: 'simple'|'aller_retour'|'roi', nextChallenger?: { userId, pseudo }, leg?: 1|2 },
    league?: { leagueId, matchId },
    dice?: { commitment, revealed: boolean },
    startedAt, endedAt }
  ```
- `GET /v1/games/:id/dice` → preuve du dé (écran 22) : `{ commitment, serverSeed | null, rolls: [{ rollIndex, seat, clientSeed, value }] }`.
- Côté appli : l'équipe déclare `setRemoteControllerFactory('dames' | 'ludo', …)` (`src/features/game/registry.ts`) ; les écrans de partie appellent `resolveController(family, id)`.
- Temps réel (WS, `@kwatt/protocol` `ws/games.ts`) : client → `game.subscribe {gameId, spectate?}`, `game.move {gameId, seq, move}`, `game.roll {gameId, seq, clientSeed}`, `game.resign`, `game.draw.offer`, `game.draw.answer {accept}`, `game.react {key}`, `game.sync` ; serveur → `game.state {gameId, seq, state, clocks, seats, legal?}`, `game.event {gameId, seq, event}`, `game.end {gameId, outcome}`.
- Service serveur pour les ligues : `createGame(tx, { context: 'league', variant, seats: [{ userId }], clock, rated: true, stake: 0, league: { leagueId, matchId }, startAt? })` → `{ gameId }`, et l'événement `onGameFinished(listener)` (le listener reçoit `{ gameId, context, league?, outcome, seats }`).

## C4 · Historique local et fin de partie (fournisseur : Dames ; consommateur : Ludo)

- `apps/mobile/src/features/game/history.ts` : `saveLocalGame({ id, family, variant, seats, moves, outcome, settlement?, rating?, playedAt })`, `getLocalGame(id)`, `listLocalGames(family?)` (AsyncStorage, 50 dernières).
- Écran 18 `/partie/[id]/resultat` et écran 19 `/partie/[id]/revoir` : lisent d'abord l'historique local, sinon `GET /v1/games/:id` (C3). Ils marchent pour les Dames ET le Ludo (le Ludo affiche les places, la revanche « même table », le joueur suivant du roi de la table).

## C5 · Plateaux réutilisables (fournisseurs : Dames et Ludo ; consommateurs : Parties en ligne, Communauté, Ligues)

- `apps/mobile/src/features/dames/board/DamesBoard.tsx` : `<DamesBoard state selected targets lastMove onSquarePress flipped showNumbers size interactive />`, en `react-native-svg`, couleurs de `@kwatt/design` (damier nuit et Plein soleil), cases ≥ 34 px.
- `apps/mobile/src/features/ludo/board/LudoBoard.tsx` : `<LudoBoard state geometry highlighted onTokenPress size />` pour la croix, l'étoile, le Parchís et le Pachisi, à partir de la géométrie exportée par `@kwatt/rules-ludo`, pions doublés d'une forme.
- Écrans de partie : `apps/mobile/src/features/dames/GameScreen.tsx` et `apps/mobile/src/features/ludo/GameScreen.tsx` prennent un `GameController` et marchent en local comme en distant (pendules, réactions, proposer la nulle, abandon, menu, spectateur si `mySeats()` est vide).

## C6 · Amis et présence (fournisseur : Communauté ; consommateurs : Parties en ligne)

- `GET /v1/friends` → `{ items: [{ userId, pseudo, avatar, online, activity?: { kind: 'playing'|'watching', gameId?, family? }, lastSeenAt }] }`. Invitation au salon : `POST /v1/rooms/:code/invite { userId }` (fourni par Parties en ligne) → notification `room.invite` au destinataire.
- `app.realtime.setPresenceAudience(userId → amis)` branché par Communauté.
