/**
 * Problèmes du jour (écran 19b) : positions où le camp au trait gagne du
 * matériel ou va à dame par une suite forcée.
 *
 * Un problème est vérifiable sans le moteur :
 * - chaque coup de la solution est légal (rules-dames) ;
 * - chaque réponse du défenseur est **forcée** (son seul coup légal) : c'est
 *   ce qui rend la solution « forcée » ;
 * - à la fin, le gain annoncé est acquis (valeur : pion 1, dame 2) et le
 *   défenseur n'a aucune prise pour le reprendre.
 * Le générateur ajoute deux contrôles par le moteur : le premier coup est le
 * seul qui gagne (écart ≥ 1,5 pion avec le deuxième meilleur), et le gain
 * tient encore après la fin de la suite.
 */
import { applyMove, boardFrom, fromPosition, legalMoves, parseNotation, toNotation, type DamesState, type Piece, type Side, type Variant } from '@kwatt/rules-dames';
import { Position, emoveKey, emoveNotation, type EMove } from './core.js';
import { defaultWeights, evaluate } from './evaluate.js';
import { MATE_BOUND, Search, runSync } from './search.js';

export type PuzzleTheme = 'shot' | 'coup_de_dame' | 'rafle' | 'capture_choice' | 'win_material';

export interface PuzzleSide {
  men: number[];
  kings: number[];
}

export interface Puzzle {
  id: string;
  variant: Variant;
  /** Camp qui joue (et qui doit trouver la solution). */
  side: Side;
  white: PuzzleSide;
  black: PuzzleSide;
  /** Suite forcée, en notation officielle : coups du camp au trait et réponses forcées du défenseur. */
  solution: string[];
  /** Gain à la fin de la suite (pion 1, dame 2 ; une promotion compte 1). */
  gain: number;
  /** 1 (facile) à 5 (difficile). */
  difficulty: number;
  theme: PuzzleTheme;
}

export interface PuzzleFile {
  version: 1;
  variant: Variant;
  puzzles: Puzzle[];
}

const isSquares = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => Number.isInteger(x) && x >= 1 && x <= 50);
const isSide = (v: unknown): v is PuzzleSide =>
  typeof v === 'object' && v !== null && isSquares((v as PuzzleSide).men) && isSquares((v as PuzzleSide).kings);

/** Contrôle de forme d'un fichier de problèmes (lu depuis le JSON livré avec le paquet). */
export function isPuzzleFile(v: unknown): v is PuzzleFile {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as PuzzleFile;
  if (f.version !== 1 || (f.variant !== 'dames10' && f.variant !== 'dames8') || !Array.isArray(f.puzzles)) return false;
  return f.puzzles.every(
    (p) =>
      typeof p.id === 'string' &&
      p.variant === f.variant &&
      (p.side === 'w' || p.side === 'b') &&
      isSide(p.white) &&
      isSide(p.black) &&
      Array.isArray(p.solution) &&
      p.solution.every((s) => typeof s === 'string') &&
      Number.isInteger(p.gain) &&
      Number.isInteger(p.difficulty) &&
      typeof p.theme === 'string',
  );
}

/** État de départ d'un problème. */
export function puzzleState(p: Puzzle): DamesState {
  const pieces: Partial<Record<Exclude<Piece, ''>, number[]>> = { w: p.white.men, W: p.white.kings, b: p.black.men, B: p.black.kings };
  return fromPosition(p.variant, boardFrom(p.variant, pieces), p.side);
}

/** Valeur matérielle d'un camp : pion 1, dame 2. */
export function materialValue(state: DamesState, side: Side): number {
  let v = 0;
  for (const piece of state.board) {
    if (side === 'w') v += piece === 'w' ? 1 : piece === 'W' ? 2 : 0;
    else v += piece === 'b' ? 1 : piece === 'B' ? 2 : 0;
  }
  return v;
}

const other = (s: Side): Side => (s === 'w' ? 'b' : 'w');

/** Bilan matériel du point de vue d'un camp. */
export function balance(state: DamesState, side: Side): number {
  return materialValue(state, side) - materialValue(state, other(side));
}

export interface PuzzleCheck {
  ok: boolean;
  errors: string[];
  /** Gain constaté à la fin de la suite. */
  gain: number;
  final: DamesState | null;
}

/**
 * Vérifie un problème sans moteur : légalité, réponses forcées, gain acquis,
 * fin calme pour le défenseur, au moins deux coups possibles au départ.
 */
export function verifyPuzzle(p: Puzzle): PuzzleCheck {
  const errors: string[] = [];
  let state = puzzleState(p);
  if (legalMoves(state).length < 2) errors.push('un seul coup possible au départ');
  const start = balance(state, p.side);
  for (const [i, text] of p.solution.entries()) {
    if (state.result) {
      errors.push(`partie finie avant le coup ${i + 1}`);
      break;
    }
    const mover = state.turn;
    if (mover !== (i % 2 === 0 ? p.side : other(p.side))) errors.push(`coup ${i + 1} joué par le mauvais camp`);
    const move = parseNotation(state, text);
    if (!move) {
      errors.push(`coup ${i + 1} illégal : ${text}`);
      return { ok: false, errors, gain: 0, final: null };
    }
    if (mover !== p.side && legalMoves(state).length !== 1) errors.push(`réponse ${text} non forcée`);
    state = applyMove(state, move);
  }
  if (p.solution.length === 0) errors.push('solution vide');
  const gain = balance(state, p.side) - start;
  if (gain < p.gain) errors.push(`gain ${gain} au lieu de ${p.gain}`);
  // Le défenseur ne reprend rien tout de suite (pas de prise), sauf si la partie est gagnée.
  if (!state.result && state.turn !== p.side) {
    const replies = legalMoves(state);
    if (replies.some((m) => m.captures.length > 0)) errors.push('le défenseur peut reprendre aussitôt');
  }
  if (!state.result && state.turn === p.side) {
    // Fin sur une réponse forcée : le camp gagnant ne doit pas être obligé de rendre du matériel.
    const pos = Position.fromState(state);
    if (pos.hasCapture() === false && !pos.hasQuietMove()) errors.push('le camp gagnant est bloqué');
  }
  return { ok: errors.length === 0, errors, gain, final: state };
}

export interface UniquenessCheck {
  ok: boolean;
  best: string;
  /** Écart entre le meilleur et le deuxième meilleur coup (centièmes de pion). */
  margin: number;
}

/** Le coup `text` est-il le seul bon coup de la position (écart ≥ `minMargin` avec le suivant) ? */
function uniqueAt(state: DamesState, text: string, depth: number, maxNodes: number, minMargin: number): UniquenessCheck {
  const pos = Position.fromState(state);
  const r = runSync(new Search(pos, { weights: defaultWeights(pos.g.size), maxDepth: depth, maxNodes, multiMargin: 400 }).run());
  const wanted = parseNotation(state, text);
  const best = r.rootScores[0]!;
  const second = r.rootScores[1];
  const margin = second ? best.score - second.score : Infinity;
  const ok = !!wanted && emoveKey({ from: wanted.from, to: wanted.to, captures: wanted.captures }) === emoveKey(best.move) && margin >= minMargin;
  return { ok, best: emoveNotation(best.move), margin };
}

/** Contrôle par le moteur : le premier coup de la solution est le seul qui gagne. */
export function checkUniqueness(p: Puzzle, options: { depth?: number; maxNodes?: number; minMargin?: number } = {}): UniquenessCheck {
  const depth = options.depth ?? Math.min(12, Math.max(4, p.solution.length + 3));
  return uniqueAt(puzzleState(p), p.solution[0] ?? '', depth, options.maxNodes ?? 400_000, options.minMargin ?? 150);
}

/**
 * Contrôle des coups suivants du camp gagnant : chacun est forcé (seul coup
 * légal) ou le seul bon coup, pour que l'appli puisse comparer le coup du
 * joueur à la solution.
 */
export function checkFollowUps(p: Puzzle, options: { maxNodes?: number; minMargin?: number } = {}): boolean {
  let state = puzzleState(p);
  for (const [i, text] of p.solution.entries()) {
    if (i > 0 && i % 2 === 0 && legalMoves(state).length > 1) {
      const depth = Math.min(10, Math.max(4, p.solution.length - i + 3));
      if (!uniqueAt(state, text, depth, options.maxNodes ?? 150_000, options.minMargin ?? 150).ok) return false;
    }
    const m = parseNotation(state, text);
    if (!m) return false;
    state = applyMove(state, m);
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Générateur                                                           */

export interface FindOptions {
  /** Profondeur de la recherche de détection (8 par défaut). */
  depth?: number;
  maxNodes?: number;
  /** Gain minimal (2 par défaut). */
  minGain?: number;
  /** Longueur maximale de la suite, en demi-coups (11 par défaut). */
  maxPlies?: number;
}

function sidePieces(state: DamesState, s: Side): PuzzleSide {
  const man = s === 'w' ? 'w' : 'b';
  const king = s === 'w' ? 'W' : 'B';
  const men: number[] = [];
  const kings: number[] = [];
  state.board.forEach((p, i) => {
    if (p === man) men.push(i + 1);
    if (p === king) kings.push(i + 1);
  });
  return { men, kings };
}

function bestMove(state: DamesState, depth: number, maxNodes: number): { move: EMove; score: number } | null {
  const pos = Position.fromState(state);
  const r = runSync(new Search(pos, { weights: defaultWeights(pos.g.size), maxDepth: depth, maxNodes }).run());
  return r.best ? { move: r.best, score: r.score } : null;
}

/**
 * Cherche une combinaison dans une position : suite où le défenseur n'a
 * jamais le choix, qui gagne au moins `minGain`. Renvoie un problème (sans
 * identifiant) ou null.
 */
export function findPuzzle(state: DamesState, options: FindOptions = {}): Omit<Puzzle, 'id'> | null {
  if (state.result) return null;
  const depth = options.depth ?? 8;
  const maxNodes = options.maxNodes ?? 120_000;
  const minGain = options.minGain ?? 2;
  const maxPlies = options.maxPlies ?? 11;
  const startMoves = legalMoves(state);
  if (startMoves.length < 2) return null;
  // Matériel à peu près égal au départ : le problème porte sur la combinaison.
  const side = state.turn;
  if (Math.abs(balance(state, side)) > 1) return null;
  // Détection rapide : le moteur voit-il un gain net ?
  const first = bestMove(state, depth, maxNodes);
  const pos0 = Position.fromState(state);
  const static0 = evaluate(pos0, defaultWeights(pos0.g.size));
  if (!first || first.score - static0 < 150 || first.score > MATE_BOUND) return null;

  // Suite forcée : le défenseur n'a jamais le choix.
  const line: string[] = [];
  let s = state;
  let promoted = false;
  let sacrifice = false;
  let maxCapture = 0;
  const start = balance(state, side);
  const kings0 = sidePieces(state, side).kings.length;
  for (let ply = 0; ply < maxPlies; ply++) {
    if (s.result) break;
    if (s.turn === side) {
      const gainNow = balance(s, side) - start;
      const pos = Position.fromState(s);
      if (line.length > 0 && gainNow >= minGain && !pos.hasCapture()) break;
      const b = ply === 0 ? first : bestMove(s, depth, maxNodes);
      if (!b) return null;
      const m = { from: b.move.from, to: b.move.to, captures: b.move.caps };
      maxCapture = Math.max(maxCapture, m.captures.length);
      const next = applyMove(s, m);
      line.push(emoveNotation(b.move));
      // Sacrifice : coup sans prise après lequel le défenseur doit prendre.
      if (ply === 0 && m.captures.length === 0 && legalMoves(next).some((x) => x.captures.length > 0)) sacrifice = true;
      s = next;
    } else {
      const replies = legalMoves(s);
      if (replies.length === 1) {
        line.push(toNotation(replies[0]!));
        s = applyMove(s, replies[0]!);
        continue;
      }
      // Le défenseur a le choix : la suite s'arrête ici, seulement s'il ne peut rien reprendre.
      if (replies.some((x) => x.captures.length > 0)) return null;
      break;
    }
  }
  if (sidePieces(s, side).kings.length > kings0) promoted = true;
  const gain = balance(s, side) - start;
  if (gain < minGain) return null;
  const attackerMoves = Math.ceil(line.length / 2);
  const startsWithCapture = startMoves[0]!.captures.length > 0;
  const theme: PuzzleTheme = promoted
    ? 'coup_de_dame'
    : sacrifice
      ? 'shot'
      : maxCapture >= 3
        ? 'rafle'
        : startsWithCapture
          ? 'capture_choice'
          : 'win_material';
  const difficulty = Math.max(1, Math.min(5, attackerMoves + (sacrifice ? 1 : 0) - (theme === 'capture_choice' ? 1 : 0)));
  const puzzle: Omit<Puzzle, 'id'> = {
    variant: state.variant,
    side,
    white: sidePieces(state, 'w'),
    black: sidePieces(state, 'b'),
    solution: line,
    gain,
    difficulty,
    theme,
  };
  // Contrôles : suite vérifiable sans moteur, premier coup unique, gain qui tient.
  const check = verifyPuzzle({ ...puzzle, id: 'candidat' });
  if (!check.ok || !check.final) return null;
  if (!checkUniqueness({ ...puzzle, id: 'candidat' }, { maxNodes: 200_000 }).ok) return null;
  if (!checkFollowUps({ ...puzzle, id: 'candidat' })) return null;
  if (!check.final.result) {
    const endPos = Position.fromState(check.final);
    const r = runSync(new Search(endPos, { weights: defaultWeights(endPos.g.size), maxDepth: 6, maxNodes: 60_000 }).run());
    const forSide = check.final.turn === side ? r.score : -r.score;
    if (forSide - static0 < 120) return null;
  }
  return puzzle;
}

/**
 * Problème du jour : même problème pour tout le monde un jour donné
 * (numéro de jour du domaine, heure du Cameroun), en parcourant la liste dans
 * un ordre mélangé fixe pour alterner thèmes et difficultés.
 */
export function dailyPuzzle<T>(puzzles: readonly T[], dayNumber: number): T {
  if (puzzles.length === 0) throw new Error('Aucun problème');
  const n = puzzles.length;
  // Pas premier avec n : chaque problème revient une fois par cycle de n jours.
  let step = Math.floor(n * 0.618) || 1;
  while (gcd(step, n) !== 1) step++;
  const i = (((dayNumber * step) % n) + n) % n;
  return puzzles[i]!;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
