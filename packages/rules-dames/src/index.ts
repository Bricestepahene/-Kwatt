/**
 * Règles exactes des dames, sans I/O : la même fonction valide un coup sur le
 * serveur (qui fait foi) et affiche les coups légaux dans l'appli.
 *
 * - dames10 : internationales 10×10. Les blancs commencent. Prise obligatoire
 *   et majoritaire, en avant et en arrière ; dame volante ; les pions pris sont
 *   retirés à la fin de la rafle et ne peuvent pas être sautés deux fois ; un
 *   pion ne devient dame que s'il termine son coup sur la dernière rangée.
 * - dames8 : anglaises 8×8. Les noirs commencent. Pions qui prennent vers
 *   l'avant seulement ; libre choix de la prise (rafle menée jusqu'au bout) ;
 *   dame courte ; un pion qui atteint la dernière rangée devient dame et son
 *   tour s'arrête là.
 */
import { buildRays, GEOMETRY_10, GEOMETRY_8, type Geometry } from './board.js';

export { toCoord, toSquare, GEOMETRY_10, GEOMETRY_8 } from './board.js';
export type { Geometry } from './board.js';

export type Variant = 'dames10' | 'dames8';
export type Side = 'w' | 'b';
/** w, b : pions ; W, B : dames ; '' : case vide. */
export type Piece = '' | 'w' | 'W' | 'b' | 'B';

export interface Move {
  from: number;
  to: number;
  /** Cases visitées, départ et arrivée compris. */
  path: number[];
  /** Cases des pièces prises, dans l'ordre de la rafle. */
  captures: number[];
}

export type EndReason = 'no_moves' | 'repetition' | 'quiet_kings' | 'resign' | 'agreement' | 'timeout';

export interface Result {
  /** null = partie nulle. */
  winner: Side | null;
  reason: EndReason;
}

export interface DamesState {
  variant: Variant;
  board: Piece[];
  turn: Side;
  ply: number;
  /** Demi-coups consécutifs faits uniquement par des dames, sans prise. */
  quietKingPlies: number;
  /** Nombre d'apparitions de chaque position (camp au trait compris). */
  seen: Record<string, number>;
  result: Result | null;
}

interface Rules {
  geometry: Geometry;
  firstToMove: Side;
  /** Camp placé en haut du damier (cases 1, 2, …). */
  topSide: Side;
  menCaptureBackward: boolean;
  flyingKings: boolean;
  majorityCapture: boolean;
  promotionStopsCapture: boolean;
  /** Nulle si ce nombre de demi-coups de dames sans prise ni pion joué est atteint. */
  quietKingPliesLimit: number;
  repetitionLimit: number;
}

export const RULES: Record<Variant, Rules> = {
  dames10: {
    geometry: GEOMETRY_10,
    firstToMove: 'w',
    topSide: 'b',
    menCaptureBackward: true,
    flyingKings: true,
    majorityCapture: true,
    promotionStopsCapture: false,
    // « 25 coups de dames de suite sans prise ni pion joué » (planche Compétitions) : 25 par joueur.
    quietKingPliesLimit: 50,
    repetitionLimit: 3,
  },
  dames8: {
    geometry: GEOMETRY_8,
    firstToMove: 'b',
    topSide: 'b',
    menCaptureBackward: false,
    flyingKings: false,
    majorityCapture: false,
    promotionStopsCapture: true,
    // Seuil à valider avec la fédération (planche Compétitions) ; 40 coups par joueur par défaut.
    quietKingPliesLimit: 80,
    repetitionLimit: 3,
  },
};

const raysCache = new Map<number, number[][][]>();
function rays(g: Geometry): number[][][] {
  let r = raysCache.get(g.size);
  if (!r) {
    r = buildRays(g);
    raysCache.set(g.size, r);
  }
  return r;
}

const sideOf = (p: Piece): Side | null => (p === '' ? null : p === 'w' || p === 'W' ? 'w' : 'b');
const isKing = (p: Piece): boolean => p === 'W' || p === 'B';
export const opponent = (s: Side): Side => (s === 'w' ? 'b' : 'w');

/** Index de direction (voir DIRECTIONS) vers l'avant pour un camp. */
function forwardDirs(rules: Rules, side: Side): number[] {
  const goesDown = side === rules.topSide;
  return goesDown ? [2, 3] : [0, 1];
}

function promotionRow(rules: Rules, side: Side): number {
  return side === rules.topSide ? rules.geometry.size - 1 : 0;
}

function rowOf(g: Geometry, square: number): number {
  return Math.floor((square - 1) / (g.size / 2));
}

export function positionKey(board: Piece[], turn: Side): string {
  return turn + ':' + board.map((p) => p || '.').join('');
}

export function initialState(variant: Variant): DamesState {
  const rules = RULES[variant];
  const g = rules.geometry;
  const perRow = g.size / 2;
  const board: Piece[] = Array.from({ length: g.squares }, () => '' as Piece);
  const top = rules.topSide;
  const bottom = opponent(top);
  for (let i = 0; i < g.startRows * perRow; i++) board[i] = top;
  for (let i = g.squares - g.startRows * perRow; i < g.squares; i++) board[i] = bottom;
  return fromPosition(variant, board, rules.firstToMove);
}

/** Construit un état à partir d'une position (problèmes, tests, reprise). */
export function fromPosition(variant: Variant, board: Piece[], turn: Side, ply = 0): DamesState {
  if (board.length !== RULES[variant].geometry.squares) throw new Error('Taille de damier invalide');
  return { variant, board: [...board], turn, ply, quietKingPlies: 0, seen: { [positionKey(board, turn)]: 1 }, result: null };
}

/** Pose des pièces sur un damier vide : `{ w: [31, 32], B: [5] }`. */
export function boardFrom(variant: Variant, pieces: Partial<Record<Exclude<Piece, ''>, number[]>>): Piece[] {
  const board: Piece[] = Array.from({ length: RULES[variant].geometry.squares }, () => '' as Piece);
  for (const [p, squares] of Object.entries(pieces) as [Exclude<Piece, ''>, number[]][]) {
    for (const s of squares) board[s - 1] = p;
  }
  return board;
}

function captureSequences(rules: Rules, board: Piece[], from: number): Move[] {
  const g = rules.geometry;
  const allRays = rays(g);
  const piece = board[from - 1]!;
  const side = sideOf(piece)!;
  const king = isKing(piece);
  const results: Move[] = [];
  // La pièce qui joue quitte sa case : elle peut repasser par son point de départ.
  const work = [...board];
  work[from - 1] = '';
  const taken = new Set<number>();

  const dirs = king || rules.menCaptureBackward ? [0, 1, 2, 3] : forwardDirs(rules, side);

  const explore = (at: number, path: number[], caps: number[]): void => {
    let extended = false;
    const promotedHere = !king && rules.promotionStopsCapture && caps.length > 0 && rowOf(g, at) === promotionRow(rules, side);
    if (!promotedHere) {
      for (const d of dirs) {
        const ray = allRays[at - 1]![d]!;
        let i = 0;
        if (king && rules.flyingKings) {
          while (i < ray.length && work[ray[i]! - 1] === '') i++;
        }
        const victim = ray[i];
        if (victim === undefined) continue;
        const vp = work[victim - 1]!;
        if (sideOf(vp) !== opponent(side) || taken.has(victim)) continue;
        const landings: number[] = [];
        for (let j = i + 1; j < ray.length; j++) {
          if (work[ray[j]! - 1] !== '') break;
          landings.push(ray[j]!);
          if (!(king && rules.flyingKings)) break;
        }
        for (const land of landings) {
          extended = true;
          taken.add(victim);
          explore(land, [...path, land], [...caps, victim]);
          taken.delete(victim);
        }
      }
    }
    if (!extended && caps.length > 0) results.push({ from, to: at, path, captures: caps });
  };
  explore(from, [from], []);
  return results;
}

function simpleMoves(rules: Rules, board: Piece[], from: number): Move[] {
  const allRays = rays(rules.geometry);
  const piece = board[from - 1]!;
  const side = sideOf(piece)!;
  const king = isKing(piece);
  const out: Move[] = [];
  const dirs = king ? [0, 1, 2, 3] : forwardDirs(rules, side);
  for (const d of dirs) {
    for (const sq of allRays[from - 1]![d]!) {
      if (board[sq - 1] !== '') break;
      out.push({ from, to: sq, path: [from, sq], captures: [] });
      if (!(king && rules.flyingKings)) break;
    }
  }
  return out;
}

/** Clé d'identité d'un coup : deux chemins qui prennent les mêmes pièces sont le même coup. */
export function moveKey(m: Move): string {
  return `${m.from}-${m.to}:${[...m.captures].sort((a, b) => a - b).join(',')}`;
}

export function legalMoves(state: DamesState): Move[] {
  if (state.result) return [];
  const rules = RULES[state.variant];
  const { board, turn } = state;
  let captures: Move[] = [];
  for (let s = 1; s <= board.length; s++) {
    if (sideOf(board[s - 1]!) === turn) captures.push(...captureSequences(rules, board, s));
  }
  if (captures.length > 0) {
    if (rules.majorityCapture) {
      const max = Math.max(...captures.map((m) => m.captures.length));
      captures = captures.filter((m) => m.captures.length === max);
    }
    const unique = new Map<string, Move>();
    for (const m of captures) if (!unique.has(moveKey(m))) unique.set(moveKey(m), m);
    return [...unique.values()];
  }
  const moves: Move[] = [];
  for (let s = 1; s <= board.length; s++) {
    if (sideOf(board[s - 1]!) === turn) moves.push(...simpleMoves(rules, board, s));
  }
  return moves;
}

/** Cherche un coup légal identique (le client n'est jamais cru sur parole). */
export function findLegal(state: DamesState, candidate: Pick<Move, 'from' | 'to'> & { captures?: number[] }): Move | null {
  const legal = legalMoves(state).filter((m) => m.from === candidate.from && m.to === candidate.to);
  if (candidate.captures) {
    const key = moveKey({ ...candidate, path: [], captures: candidate.captures });
    return legal.find((m) => moveKey(m) === key) ?? null;
  }
  return legal.length === 1 ? legal[0]! : null;
}

export class IllegalMoveError extends Error {}

/** Joue un coup. Renvoie un nouvel état ; lève IllegalMoveError si le coup n'est pas légal. */
export function applyMove(state: DamesState, candidate: Pick<Move, 'from' | 'to'> & { captures?: number[] }): DamesState {
  if (state.result) throw new IllegalMoveError('La partie est terminée');
  const move = findLegal(state, candidate);
  if (!move) throw new IllegalMoveError(`Coup illégal : ${candidate.from}-${candidate.to}`);
  const rules = RULES[state.variant];
  const board = [...state.board];
  const piece = board[move.from - 1]!;
  board[move.from - 1] = '';
  for (const c of move.captures) board[c - 1] = '';
  const side = state.turn;
  const promotes = !isKing(piece) && rowOf(rules.geometry, move.to) === promotionRow(rules, side);
  board[move.to - 1] = promotes ? (side === 'w' ? 'W' : 'B') : piece;

  const kingQuiet = isKing(piece) && move.captures.length === 0;
  const quietKingPlies = kingQuiet ? state.quietKingPlies + 1 : 0;
  const turn = opponent(side);
  const key = positionKey(board, turn);
  // Une prise ou un pion joué rend toute répétition antérieure impossible.
  const seen = kingQuiet ? { ...state.seen, [key]: (state.seen[key] ?? 0) + 1 } : { [key]: 1 };

  const next: DamesState = { variant: state.variant, board, turn, ply: state.ply + 1, quietKingPlies, seen, result: null };
  next.result = detectEnd(next);
  return next;
}

function detectEnd(state: DamesState): Result | null {
  const rules = RULES[state.variant];
  if (legalMoves(state).length === 0) return { winner: opponent(state.turn), reason: 'no_moves' };
  if ((state.seen[positionKey(state.board, state.turn)] ?? 0) >= rules.repetitionLimit) return { winner: null, reason: 'repetition' };
  if (state.quietKingPlies >= rules.quietKingPliesLimit) return { winner: null, reason: 'quiet_kings' };
  return null;
}

/** Demi-coups restants avant la nulle « seules les dames bougent » (écran 16). */
export function pliesUntilQuietDraw(state: DamesState): number {
  return RULES[state.variant].quietKingPliesLimit - state.quietKingPlies;
}

export function resign(state: DamesState, side: Side): DamesState {
  return { ...state, result: { winner: opponent(side), reason: 'resign' } };
}

export function timeout(state: DamesState, side: Side): DamesState {
  return { ...state, result: { winner: opponent(side), reason: 'timeout' } };
}

export function agreeDraw(state: DamesState): DamesState {
  return { ...state, result: { winner: null, reason: 'agreement' } };
}

/** Notation officielle : « 32-28 » ou « 28x19x10 » pour une rafle. */
export function toNotation(move: Move): string {
  return move.captures.length ? move.path.join('x') : `${move.from}-${move.to}`;
}

export function parseNotation(state: DamesState, text: string): Move | null {
  const capture = text.includes('x');
  const parts = text.split(capture ? 'x' : '-').map((n) => Number.parseInt(n, 10));
  if (parts.length < 2 || parts.some((n) => !Number.isInteger(n))) return null;
  const from = parts[0]!;
  const to = parts[parts.length - 1]!;
  const candidates = legalMoves(state).filter(
    (m) => m.from === from && m.to === to && (m.captures.length > 0) === capture,
  );
  if (parts.length > 2) {
    const exact = candidates.filter((m) => parts.every((p) => m.path.includes(p)));
    return exact.length === 1 ? exact[0]! : null;
  }
  return candidates.length === 1 ? candidates[0]! : null;
}

export function countPieces(state: DamesState, side: Side): number {
  return state.board.filter((p) => sideOf(p) === side).length;
}
