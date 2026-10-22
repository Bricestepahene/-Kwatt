/**
 * @kwatt/engine-dames : l'IA des dames (planche Moteur), sur les règles de
 * @kwatt/rules-dames. Utilisée par le serveur (machine en ligne, analyse,
 * anti-triche) et par l'appli (hors connexion, « Revoir », indice).
 *
 * - `chooseMove(state, { targetRating, timeMs, seed })` : un coup, à pleine
 *   force ou comme un humain de la force visée (asynchrone, découpé) ;
 * - `hint`, `analyzeGame`, `agreementRate` : indice, revue d'une partie, taux
 *   d'accord avec le moteur ;
 * - problèmes du jour : `puzzles/dames10.json`, `puzzles/dames8.json`,
 *   vérifiés par `verifyPuzzle`.
 * Chaque fonction asynchrone a une version `…Sync` (même résultat).
 */
export { chooseMove, chooseMoveSync, chooseMoveGen, type ChooseMoveOptions, type EngineChoice } from './play.js';
export { LEVEL_IDS, LEVEL_RATINGS, levelIdFor, levelProfile, levelWeights, type LevelId, type LevelProfile } from './levels.js';
export {
  analyzeGame,
  analyzeGameSync,
  analyzeGameGen,
  hint,
  hintSync,
  hintGen,
  agreementRate,
  agreementRateSync,
  agreementRateGen,
  replay,
  qualityOf,
  QUALITY_THRESHOLDS,
  REVIEW_THRESHOLDS,
  type AnalysisBudget,
  type AnalyzedMove,
  type GameAnalysis,
  type KeyMoment,
  type KeyMomentKind,
  type MoveQuality,
  type MoveInput,
  type Hint,
  type HintReason,
  type AgreementOptions,
  type AgreementReport,
} from './analysis.js';
export {
  verifyPuzzle,
  checkUniqueness,
  checkFollowUps,
  findPuzzle,
  dailyPuzzle,
  isPuzzleFile,
  puzzleState,
  materialValue,
  type Puzzle,
  type PuzzleFile,
  type PuzzleSide,
  type PuzzleTheme,
  type PuzzleCheck,
} from './puzzles.js';
export { playMatch, type MatchOptions, type MatchResult } from './match.js';
export { evaluateTerms, defaultWeights, WEIGHTS_10, WEIGHTS_8, type EvalTerms, type EvalWeights } from './evaluate.js';
export {
  Search,
  TranspositionTable,
  runAsync,
  runSync,
  SearchCancelledError,
  MATE,
  MATE_BOUND,
  type AsyncDriveOptions,
  type CancelToken,
  type SearchOptions,
  type SearchResult,
  type RootScore,
} from './search.js';
export { Position, initialPosition, emoveKey, emoveNotation, toRulesMove, type EMove } from './core.js';
export { mulberry32, mixSeed } from './random.js';
