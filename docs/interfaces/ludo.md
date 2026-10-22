# Interfaces · équipe Ludo (vague 2)

Écrans 20, 20b, 21, 21b, 21c, 23 ; contrat C5 côté Ludo ; finition du moteur (calibration, research/ludo). Le code fait foi en cas d'écart.

## Base (migration 0050)
- `house_rule_sets` : `id`, `owner_id` (→ users, cascade), `name` (1–40, unique par joueur sans casse ni espaces autour), `preset` (classique | rapide | six | parchis | pachisi), `rules` jsonb (réglages maison normalisés, jamais vide), `created_at`, `updated_at`.

## Protocole (`@kwatt/protocol`)
- `http/ludo.ts` : `LUDO_PRESETS`, `LudoPresetSchema`, `LUDO_EXIT_RULES`, `LUDO_CAPTURE_RULES`, `LUDO_PROTECTION_RULES`, `LUDO_BARRIER_RULES`, `HouseRulesSchema` (`{exit?, capture?, protection?, barriers?}`, strict), `HOUSE_RULE_SET_NAME_MAX` (40), `HOUSE_RULE_SETS_MAX` (20), `HouseRuleSetSchema` (`{id, name, preset, rules, createdAt, updatedAt}`), `HouseRuleSetListSchema`, `CreateHouseRuleSetRequestSchema`, `UpdateHouseRuleSetRequestSchema`.
- `errors/ludo.ts` : les codes de `@kwatt/rules-ludo` recopiés tels quels (`ludo.setup.*`, `ludo.roll.*`, `ludo.move.*`, `ludo.seat.invalid` ; un test serveur vérifie l'égalité des listes) + `ludo.house_rules.not_found | name_taken | limit (params {max}) | empty`. Traduits dans `errors.json` fr/en. Les codes à trois segments sont désormais permis par le test du protocole (`module.groupe.nom`).
- `http/machine.ts`, `http/games.ts`, `http/ratings.ts` : ceux de l'équipe Dames (identiques).

## Serveur (module `ludo`)
- REST (profils seulement, invité → 403) :
  - `GET /v1/ludo/house-rules` → `{ items: HouseRuleSet[] }` (plus récent d'abord)
  - `POST /v1/ludo/house-rules` `{ name, preset, rules }` → 201 `HouseRuleSet`
  - `GET /v1/ludo/house-rules/:id` → `HouseRuleSet` (celui d'un autre joueur : 404 `ludo.house_rules.not_found`)
  - `PUT /v1/ludo/house-rules/:id` `{ name?, preset?, rules? }` → `HouseRuleSet` (changer de variante revérifie les règles)
  - `DELETE /v1/ludo/house-rules/:id` → `{ ok: true }`
  - Combinaison bloquée → 422 avec le code de `validateSetup` (`ludo.setup.barrier_lock`, `ludo.setup.throw_incompatible`, `ludo.setup.house_option`…) ; règles identiques à la variante → 422 `ludo.house_rules.empty` ; nom pris → 409 `ludo.house_rules.name_taken` ; plus de 20 → 409 `ludo.house_rules.limit`.
- Fonctions exportées (`modules/ludo/service.ts`), pour la création d'un salon (Parties en ligne) : `loadHouseRuleSet(db, ownerId, id) → HouseRuleSet` (404 sinon), `checkHouseRules(preset, rules) → HouseRules` (normalisées, lève l'AppError du code des règles), `toHouseRules(dto)`, `setupFor(preset, house)`, `listHouseRuleSets`, `createHouseRuleSet`, `updateHouseRuleSet`, `deleteHouseRuleSet`.
- Comptes : section d'export `ludo_house_rules`, effacement à J+30.
- Test de compatibilité : la notation enregistrée par l'appli est rejouée par `replayLudo` du module machine (toutes les variantes, `modules/ludo/notation.test.ts`).

## Règles (`@kwatt/rules-ludo`, ajouts compatibles)
- `notation.ts` : `LUDO_NOTATION` (regex), `NotationLog {moves, pendingRoll}`, `emptyLog()`, `tokenNotation(state, move)`, `recordRoll(log, après, valeur)`, `recordMove(log, avant, coup)`, `replayNotation(options, moves, pendingRoll?) → LudoState`, `replayStates(options, moves) → LudoState[]` (départ + une position par entrée). Format C2 : `« 6:2 »`, `« 6:2.1 »` (pion 1 du siège 2, partenaire), `« 3:- »`, `« b:0 »` (bonus du Parchís).

## Appli (`src/features/ludo/`)
- **C5** `board/LudoBoard.tsx` : `<LudoBoard state geometry highlighted onTokenPress size tokenLabel? accessibilityLabel? />` — `state: LudoState`, `geometry = boardGeometry(state.config.board)`, `highlighted: {seat, token}[]` (pions jouables : anneau sombre + zone tactile ≥ 48 px annoncée), `onTokenPress(seat, token)`, `size` en px. Croix, étoile, Parchís, Pachisi ; pions doublés d'une forme (`ludoSeats`). Aussi `SeatGlyph({home, size})`. Logique pure : `board/layout.ts` (`cellViews`, `centerTriangles`, `tokenViews`, `stackOffsets`, `baseRadius`, `hitRadius`), `board/TokenShape.tsx` (`TokenShape`, `Shape`, `seatStyle`, `ringFor`).
- **C5** `GameScreen.tsx` : `<LudoGameScreen controller />` pour un `GameController<LudoState, LudoMove>` (local ou distant ; spectateur si `mySeats()` est vide). Lit `getState`, `subscribe` (événements `roll` {value, playable, shells?}, `move` {token, owner, from, to, captures, home, auto, bonus}, `turn`, `end`), `legalMoves`, `roll`, `play`, `resign`, `clock()` (chrono 30 s du tour, affiché si non nul), `seats()` (`connected: false` → « ne répond plus », bandeau pointillé). Méthodes facultatives lues si présentes : `lastRoll()`, `timeLeftMs()` (Rapide), `canRoll()`. Fin : `/partie/<id>/resultat` après 1,4 s. Aussi `isWin(state, places, seat)`.
- `GameRoute.tsx` (`/ludo/partie/[id]`, `?spectate=1`) : registre → reprise locale → `resolveController('ludo', id)` (fabrique distante de Parties en ligne).
- Partie locale : `local/controller.ts` (`LocalLudoController`, `LocalLudoOptions`, `LocalLudoSnapshot`, `readLocalLudo`, `newSeed`, `PLAYER_SEAT = 0`, clé `kwatt.ludo.local.v1`), `local/runtime.ts` (`startLocalLudo(options)`, `resumeLocalLudo(id)`, `savedLocalLudo()`, `machineDelays()`), `local/dice.ts` (`rollDie`, `throwCowries`, `throwFor`, `shellsForValue`). Joueur au siège 0, machines aux sièges 1…n, Pachisi `[[0,2],[1,3]]` ; machine = `chooseMove` de `@kwatt/ludo-ai` au niveau de la difficulté ; dés par `expo-crypto getRandomValues`.
- Fin de partie locale : `offline.ts` `recordFinishedGame(game, options, moves)` → `saveLocalGame` (C4) puis `enqueueMachineResult` (C2, `machineResults.ts` de l'équipe Dames) si `options.submit` (profil, sans règles maison) ; `resultRequest(options, moves)`.
- `LudoReplay.tsx` : `<LudoReplay variant players moves />` et `replayFor(...)`, branché dans l'écran 19 commun (`ReviewScreen`).
- Écrans : `ModeScreen` (20, `/jouer/ludo`, `?jouer=1` ouvre le lancement contre la machine), `MachineSheet` (machines 1–3, difficultés C2, auto, pari via `POST /v1/games/machine` C3 pour un profil majeur en ligne), `VariantsScreen` (20b), `RulesScreen` (23, `/regles/dames|dames8|ludo`).
- Mise en place : `setup.ts` (`LudoSetup {preset, house, houseSet}`, `variantId`, `presetOfVariant`, `gameOptions`, `machineCounts`, `ruleChoices` avec combinaisons bloquées, `withRule`, `changePreset`, `isRankedSetup`, `levelFromRating`), `setupStore.ts` (`useLudoSetup`, `setLudoSetup`, clé `kwatt.ludo.setup.v1`), `mechanics.ts` (`mechanicLines`, `summaryKeys`, `ruleValueKey`), `messages.ts` (`statusMessage`).
- Données : `api.ts` (`useLudoRatings`, `useMachineOffers`, `createOnlineMachineGame`, `useHouseRuleSets`, `useSaveHouseRuleSet`, `useDeleteHouseRuleSet`, `ludoKeys`).
- Catalogue `ludo` (fr/en). `@kwatt/design` : `ludoBoard` et `cowrie` ajoutés.
- Liens sortants : `/salon/nouveau?jeu=ludo`, `/regarder`, `/ligues`, `/raisonnement`, `/jouer/dames`, `/dames/machine`.

## Moteur
- `packages/ludo-ai/CALIBRATION.md` et la table de `calibration.ts` régénérés par `pnpm --filter @kwatt/ludo-ai-service calibrate` (nouveau script `services/ludo-ai/src/cli/calibrate.ts`).
- `research/ludo` : tests Python verts (`python3 -m unittest`, 8 tests dont le rejeu des parties d'or), README.
