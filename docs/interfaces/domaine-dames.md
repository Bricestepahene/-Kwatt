# Interfaces · domaine et moteur des dames

Rapport de l'équipe « Domaine + moteur dames » à la fin de la vague 1 (le code fait foi en cas d'écart). Deux paquets purs, sans I/O ni horloge (l'heure est toujours un paramètre), déterministes : `@kwatt/domain` et `@kwatt/engine-dames`.

## @kwatt/domain (calculs du domaine, SPEC §7 et planches)

Tout est exporté par `packages/domain/src/index.ts`. Aucun texte affichable : des codes (`rank.machine.notable`, `league.rank_too_low`, `stake.above_cap`…) que l'appli traduit.

- **Force** (`rating.ts`) : `START_RATING` 900, `kFactor(parties)` (32 puis 20 après 30 parties), `winProbability(toi, adverse)`, `duelChange`, `rateDuel(a, b, scoreA)` → `{a, b}` (`{before, after, delta}`), `rateMultiplayer(joueurs avec place)` (Ludo, duels deux à deux, K ÷ (n − 1)), `RATED_VARIANTS`, `isRatedVariant`.
- **Niveaux et échelons** (`ranks.ts`) : `levelFromRating` (max(1, ⌊(force − 800) ÷ 40⌋)), `ratingForLevel`, `pointsToNextLevel` (« encore 38 points pour Niv. 18 »), `RANKS` (id, bornes, `tableLimit`, `tableName`, `machineBehaviour`, `unlocks`), `rankForLevel`, `rankForRating`, `rankAtLeast`, `lowestRank`, `unlocksUpTo`, `standingFor(force)` → `{rating, level, rank, nextLevel, pointsToNextLevel}`, `PUBLIC_LEAGUE_CREATOR_MIN_RANK` ('ancien'). Identifiants : `apprenti`, `debrouillard`, `ancien`, `notable`, `chef`, `fon`.
- **Machine** (`machine.ts`) : `MACHINE_DIFFICULTIES` (facile 0,9/25, moyen 0,75/25, coriace 0,6/40, ton_niveau 0,5/60, fon 0,2/100 débloqué à Chef), `machineRating(force, p)`, `oddsHundredths(p)` (cote 0,9 ÷ p en centièmes), `betOdds`, `difficultyOffers(force, échelon)`, `settleMachineGame({difficulty, outcome, bet, oddsHundredths, winStreakBefore, rewardedToday, offline?})` → `{net, base, participation, betNet, streakBonus, counted}`, `machinePreview` (« +220 / −190 »), `streakBonusApplies`, `nextWinStreak`, `applyAutoDifficulty({difficulty, streak}, issue, échelon)`, `machineBetCap(solde)` et `validateMachineBet`, `calibrationStatus(victoires, parties)`, `WELCOME_BONUS`, `PARTICIPATION_REWARD`, `DAILY_REWARDED_MACHINE_GAMES`.
- **Mises** (`stakes.ts`) : `stakeCap(joueurs {userId, balance, rank})` → `{max, balanceCap, tableLimit, limitedBy}`, `validateStake`, `stakeRefusal({kind, age, emailVerified})`, `sameDeviceConflicts` / `canStakeTogether`, `settleStakes(mise, joueurs, gagnant | null)`.
- **Temps** (`time.ts`) : heure du Cameroun (UTC+1) pour tout le monde : `dayKey`, `dayNumber`, `dayNumberOfKey`, `monthKey`, `isoWeekKey`, `monthBounds`.
- **Quartiers** (`quarters.ts`) : `quarterPoints({ranked, winnerRating, loserRating, winnerQuarter, loserQuarter, vsMachine?})` (+3, +5 contre plus fort, +2 quartier rival), `quarterPointsMulti` (Ludo), `seasonKey`, `seasonNumber`, `seasonDaysLeft`, `canChangeQuarter`, `rankQuarters`, `seasonChampion`.
- **Pronostics** (`predictions.ts`) : `PREDICTION_STAKE` 50, `predictionsOpen({kind:'dames', ply} | {kind:'ludo', round})`, `settlePredictions(pronostics, gagnant | null)` → `{outcome: paid|refunded, reason, payouts}`, `predictionShares` (pourcentages, total 100).
- **Séries et quêtes** (`quests.ts`) : `recordActiveDay(série, jour)` (carte rare tous les 7 jours), `currentStreak`, `daysToNextStreakReward`, `DAILY_PUZZLE_REWARD` 10, `WEEKLY_QUESTS` (écran 40), `questProgress(quête, événements)`.
- **Ligues — argent** (`league/money.ts`) : `leagueCaution`, `leagueMinimumPlayers`, `kwattBonus`, `leaguePot`, `fullLeaguePot`, `splitPot({pot, ranking, finishers, creatorId})` → `{payouts, first, second, third, participationEach, creator, remainder}`, `forfeitFine`, `exclusionRefund`, `potBalance(mouvements)`, `cancelAfterValidation`, `validationOutcome`, `canAffordEntry`, `PUBLIC_LEAGUE_PLACES`, `PUBLIC_LEAGUE_ENTRY`, `publicLeagueCreationRefusal`, `leagueJoinRefusal`, `privateLeaguePot`, `splitPrivatePot`.
- **Ligues — calendrier** (`league/schedule.ts`) : `roundRobin(joueurs, {doubleRound?})` (méthode du cercle, exempts), `roundRobinMatchCount`, `roundRobinRoundCount`, `matchesPerPlayer`, `groupByRound`, `minimumRounds`, `packFixtures`, `withExcludedAsBye`, `recomposeAfterExclusions({unplayed, players, excluded, fromRound})` → `{mode: bye|repacked, fixtures, rested, lastRound}`.
- **Ligues — journées** (`league/matchday.ts`) : `roundDay`, `leagueEndDay`, `agreedMatchMinutes` (20:00 sans accord), `matchInstant`, `reminderInstants` (1 h et 10 min avant), `attendanceOutcome` (forfait après 10 min), `MATCH_TIME_SLOTS`.
- **Ligues — classement** (`league/standings.ts`) : `matchPoints`, `damesRows`, `damesStandings(joueurs, rencontres, {draw?, qualifyingPlaces?, playoffOrder?})` → `{rows, drawNeeded, playoffNeeded}`, `rankRows` (départage générique), `MatchOutcome` (`home_win`, `away_win`, `draw`, `home_forfeit`, `away_forfeit`, `double_forfeit`, `home_awarded`, `away_awarded`).
- **Ligues — exclusion** (`league/exclusion.ts`) : `exclusionDue(joueur, rencontres)`, `applyExclusion({excluded, matches, unplayed, totalMatches, entry})` → `{policy: annulled|kept, elapsed, remaining, matches, annulled, awarded, unplayed, refund}`.
- **Ludo en ligue** (`league/ludo.ts`) : `ludoTablePoints`, `ludoTableSizes`, `meetingCounts`, `compositionCost`, `composeLudoTables(joueurs, rencontres, {maxSize?, seed?})`, `ludoTableScores`, `ludoStandings`.
- **Équipes** (`league/teams.ts`) : `damesTeamMatch`, `homeColorOnBoard`, `teamBoards`, `lineupDeadline`, `lineupVisible`, `lineupEditable`, `effectiveLineup`, `ludoTeamRanking`.
- **Coupe** (`league/cup.ts`) : `makeGroups`, `groupName`, `groupStandings`, `groupQualifiers`, `knockoutPairs` (A1–B2, B1–A2), `nextRoundPairs`, `gameScore`, `twoLegTie(rencontre, aller, retour, manchesDécisives[])`, `deciderWhite`, `DECIDER_CLOCK_MS`.
- **Choix de planche** (`league/boards.ts`) : `decideBoard({rules, round, matchAt, hostChoice?, proposals?})` → `{board, source}`, `validateBoardRules`, `boardAllowed`, `boardIsRated`, `boardChoiceDeadline`.

## @kwatt/engine-dames (IA des dames, planche Moteur)

Exporté par `packages/engine-dames/src/index.ts`, sur `@kwatt/rules-dames` (règles inchangées ; tout coup rendu est revalidé par `findLegal`). Chaque fonction asynchrone rend la main toutes les ~12 ms (`setTimeout 0`, pas de worker_threads) et a une version `…Sync` au résultat identique. Options communes de découpage : `sliceMs`, `yieldControl`, `signal` (`{aborted}`, rejette `SearchCancelledError`), `now`.

- `chooseMove(state, {targetRating?, timeMs?, maxNodes?, seed?})` → `Promise<EngineChoice {move, notation, score, depth, nodes, level, bestNotation, deliberate, pv}>` ; `chooseMoveSync`. Sans `targetRating` : pleine force (Fon). Avec : niveau humain de la force visée (`levelProfile`), déterministe pour une graine donnée. Pour la machine : `targetRating = machineRating(force du joueur, p)` de `@kwatt/domain`.
- `levelProfile(force)`, `levelIdFor`, `LEVEL_RATINGS` (800, 1 100, 1 350, 1 550, 1 800, Fon), `levelWeights`.
- `analyzeGame(variante, coups, {depth?, maxNodesPerMove?, start?})` → `GameAnalysis {moves: AnalyzedMove[] (ply, moveNumber, side, notation, bestNotation, quality best|good|inaccuracy|mistake, loss, evalBefore, evalAfter, forced, captures, promotes), keyMoments (piece_left_hanging {square}, mistake, rafle {count}, promotion {square}, missed_win, turning_point), averageLoss, counts}` ; `analyzeGameSync`. Les coups sont en notation officielle (« 32-28 », « 28x19x10 ») ou en objets `{from, to, captures?}`.
- `hint(state, budget)` → `{move, notation, reason: only_move|capture_majority|capture|promotion|wins_material|best, score, pv}` ; `hintSync`.
- `agreementRate(variante, coups, camp, {skipOpeningMoves?, thinkTimesMs?, …})` → `{considered, agreed, nearBest, rate, averageLoss, skippedForced, thinkTimeVariation, reviewNeeded}` ; `agreementRateSync`, `REVIEW_THRESHOLDS`.
- Problèmes du jour : `@kwatt/engine-dames/puzzles/dames10.json` et `dames8.json` (`PuzzleFile {version, variant, puzzles: Puzzle {id, variant, side, white {men, kings}, black {men, kings}, solution[], gain, difficulty 1–5, theme shot|coup_de_dame|rafle|capture_choice|win_material}}`) ; `isPuzzleFile`, `puzzleState`, `verifyPuzzle` (sans moteur), `checkUniqueness`, `checkFollowUps`, `dailyPuzzle(liste, numéroDeJour)` (avec `dayNumber` de `@kwatt/domain`), `findPuzzle`. La solution alterne coups du joueur et réponses forcées de l'adversaire (que l'appli joue toute seule).
- Bas niveau : `Search`, `TranspositionTable`, `runSync`, `runAsync`, `evaluateTerms`, `Position`, `playMatch` (mini-match de contrôle).
- Scripts : `pnpm --filter @kwatt/engine-dames puzzles -- dames10 140 [parties] [graine] [fichier]` (et `puzzles -- merge dames10 a.json b.json`), `pnpm --filter @kwatt/engine-dames match -- dames10 1800 1550 10`.

## Décisions prises par l'équipe (à reporter au journal de SPEC §12)

Domaine :
- Double forfait : « 0 pt et amende pour chacun » (RegleLigues à la lettre), sans le −1 de pénalité ; il compte comme un forfait pour chacun (amende, exclusion).
- Départage : dès qu'un critère sépare un groupe, chaque sous-groupe encore à égalité repart de la confrontation directe entre ses seuls membres. Forfait et victoire attribuée comptent 1–0 dans la différence de pions.
- Exclusion : les matchs « joués » par l'exclu sont ceux qui ont un résultat, forfaits compris (Fotso : 3 joués + 2 forfaits = 5 sur 13).
- Annulation après validation : caution partagée au cauris inférieur, restes aux premiers inscrits. Pronostics : restes aux premiers parieurs, Kwatt ne prélève rien, remboursement aussi en cas de nulle ou si personne n'a vu juste ; fermeture au coup 10 = à partir du demi-coup 18.
- Équipes de dames : l'ordre devient visible à l'heure limite (1 h avant) seulement, même déposé plus tôt ; un ordre non déposé = les trois premiers de l'effectif (pas de forfait d'équipe).
- Coupe : le moins bien classé reçoit à l'aller ; une manche décisive nulle se rejoue, couleurs inversées (le receveur de l'aller a les noirs dans la première).
- Ludo en ligue : ⌈n ÷ taille⌉ tables réparties au plus juste ; points 4/2/1/0 (4), 4/2/0 (3), 4/2/1/1/0 (5), 4/2/1/1/1/0 (6), 4/0 (2).
- Ligue privée : cagnotte = inscrits × droit d'entrée, sans bonus Kwatt, entièrement au champion.
- Ligue publique : création par un profil majeur d'échelon Ancien au moins ; places 4 à 64 (pas de 2), entrée 50 à 1 000 (pas de 50), comme l'écran 31. Inscription : invité seulement en ligue privée gratuite, compte jeune dans aucune ligue payante.
- Machine : pari maximal = 25 % du solde au pas de 50 inférieur (écran 15 : 600 pour 2 450), sans limite de table ; le ×1,5 de série porte sur le gain de base de la victoire qui suit 3, 6, 9… victoires, pas sur le pari ; au-delà de 10 parties récompensées, un pari se règle encore.
- Quartiers : rien contre la machine ; « plus fort » = force strictement supérieure avant la partie ; « quartier rival » = tout autre quartier ; au Ludo, seul le 1er marque, +2 une seule fois.
- Temps : jours, semaines ISO et saisons à l'heure du Cameroun (UTC+1) pour tout le monde.

Moteur :
- Évaluation écrite à la main (pas encore de réseau appris, ni bases de finales, ni livre d'ouvertures) ; niveaux humains = vision limitée (profondeur, quiétude), bruit sur les scores, poids dégradés et plafond de perte vérifié par une recherche indépendante (pas de modèle entraîné sur de vraies parties, faute de données).
- Déterminisme garanti par les budgets de nœuds ; `timeMs` n'est qu'un garde-fou. Pour revalider une partie hors connexion, le serveur rejoue `chooseMoveSync` avec la même graine (sans `timeMs`).
- Analyse : qualité par perte ≤ 10 / 40 / 90 centièmes ; anti-triche : revue si ≥ 15 coups et (≥ 85 % d'accord avec perte moyenne ≤ 15, ou ≥ 70 % avec des temps de réflexion réguliers) ; jamais de sanction automatique.
- Problèmes : valeur pion 1, dame 2 ; défenseur toujours forcé ; au moins deux coups au départ ; premier coup unique (écart ≥ 1,5 pion) ; coups suivants forcés ou uniques ; problème du jour par rotation fixe sur le numéro de jour.

## Fragile / à suivre

- Force réelle des niveaux non mesurée sur des humains : suivre `calibrationStatus` (45–55 % à « Ton niveau ») par variante sur le serveur et ajuster les ancres de `levels.ts`.
- Fon = 800 000 nœuds (quelques secondes sur PC, davantage sur téléphone) : passer `timeMs` dans l'appli ; loin de Scan ou KingsRow.
- Déterminisme entre moteurs JavaScript (Hermes contre V8) : le bruit gaussien passe par Math.log et Math.cos ; un écart n'aurait d'effet que sur une égalité exacte.
