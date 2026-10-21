/**
 * Règles du Ludo, sans I/O et sans hasard : le dé est fourni de l'extérieur
 * (tirage vérifiable du serveur). Même état + mêmes dés = même partie.
 *
 * Deux couches, comme la planche « Réf · Variantes du Ludo » :
 * - la forme du plateau : croix (4 maisons) ou étoile à 6 branches ;
 * - les mécanismes : sortie, capture, cases protégées, lancer, victoire, équipes.
 * Chaque variante est un préréglage des deux.
 *
 * Parcours : chaque maison a 13 cases de piste. Un pion part de sa case de
 * départ (progression 0), fait le tour jusqu'à la case avant son départ
 * (progression 13 × maisons − 2), entre dans son couloir de 5 cases, puis
 * rentre au centre avec le chiffre exact.
 */

export type Preset = 'classique' | 'rapide' | 'six';
export type BoardShape = 'croix' | 'etoile';

export interface Mechanics {
  tokensPerPlayer: number;
  exitRolls: number[];
  /** Une capture donne un lancer de plus. */
  captureGivesRoll: boolean;
  /** Cases protégées : départs seulement, ou départs et étoiles. */
  safeSquares: 'departs' | 'etoiles_departs';
  /** Un 6 donne un lancer de plus ; trois 6 de suite : le tour passe. */
  sixRollsAgain: boolean;
  maxSixes: number;
}

export interface Config {
  preset: Preset;
  board: BoardShape;
  /** Nombre de maisons dessinées : 4 (croix) ou 6 (étoile). */
  homes: number;
  mechanics: Mechanics;
  /** Équipes : liste des sièges par équipe. Vide = chacun pour soi. */
  teams: number[][];
}

export const PRESETS: Record<Preset, { board: BoardShape; players: [number, number]; mechanics: Mechanics; teamSizes: number[] }> = {
  classique: {
    board: 'croix',
    players: [2, 4],
    mechanics: { tokensPerPlayer: 4, exitRolls: [6], captureGivesRoll: false, safeSquares: 'etoiles_departs', sixRollsAgain: true, maxSixes: 3 },
    teamSizes: [2],
  },
  rapide: {
    board: 'croix',
    players: [2, 4],
    mechanics: { tokensPerPlayer: 2, exitRolls: [6, 1], captureGivesRoll: true, safeSquares: 'departs', sixRollsAgain: true, maxSixes: 3 },
    teamSizes: [],
  },
  six: {
    board: 'etoile',
    players: [2, 6],
    mechanics: { tokensPerPlayer: 4, exitRolls: [6], captureGivesRoll: false, safeSquares: 'etoiles_departs', sixRollsAgain: true, maxSixes: 3 },
    teamSizes: [2, 3],
  },
};

const SQUARES_PER_HOME = 13;
const STAR_OFFSET = 8;
const HOME_COLUMN = 5;

/** Maisons occupées selon le nombre de joueurs : face à face quand c'est possible. */
export const SEATING: Record<BoardShape, Record<number, number[]>> = {
  croix: { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] },
  etoile: { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] },
};

export const BASE = -1;

export interface Seat {
  /** Maison (couleur) du siège : index dans `ludoSeats` du design. */
  home: number;
  status: 'playing' | 'finished' | 'out';
}

export interface LudoMove {
  token: number;
  from: number;
  to: number;
  captures: { seat: number; token: number }[];
}

export interface LudoState {
  config: Config;
  seats: Seat[];
  /** Progression de chaque pion, par siège : BASE, 0 … finish. */
  tokens: number[][];
  current: number;
  phase: 'roll' | 'move' | 'over';
  roll: number | null;
  sixesInRow: number;
  turnNo: number;
  /** Sièges dans l'ordre d'arrivée (1er, 2e…). */
  ranking: number[];
}

export class LudoError extends Error {}

export function trackLength(config: Config): number {
  return config.homes * SQUARES_PER_HOME;
}

/** Dernière progression sur la piste commune. */
export function lastTrack(config: Config): number {
  return trackLength(config) - 2;
}

/** Progression d'un pion rentré au centre. */
export function finish(config: Config): number {
  return lastTrack(config) + HOME_COLUMN + 1;
}

/** Case absolue de la piste (0 … 13 × maisons − 1) ou null hors piste. */
export function absoluteSquare(config: Config, home: number, progress: number): number | null {
  if (progress < 0 || progress > lastTrack(config)) return null;
  return (home * SQUARES_PER_HOME + progress) % trackLength(config);
}

export function isSafeSquare(config: Config, square: number): boolean {
  const k = square % SQUARES_PER_HOME;
  if (k === 0) return true;
  return config.mechanics.safeSquares === 'etoiles_departs' && k === STAR_OFFSET;
}

export interface NewGameOptions {
  preset: Preset;
  players: number;
  /** Équipes (sièges). Seulement pour les préréglages qui les permettent. */
  teams?: number[][];
}

/** Préréglage à utiliser pour un Ludo « classique » selon le nombre de joueurs : étoile au-delà de 4. */
export function presetForPlayers(players: number): Preset {
  return players > 4 ? 'six' : 'classique';
}

export function newGame(options: NewGameOptions): LudoState {
  const p = PRESETS[options.preset];
  const [min, max] = p.players;
  if (!Number.isInteger(options.players) || options.players < min || options.players > max) {
    throw new LudoError(`${options.preset} : de ${min} à ${max} joueurs`);
  }
  const teams = options.teams ?? [];
  if (teams.length > 0) validateTeams(options.preset, options.players, teams);
  const homes = SEATING[p.board][options.players]!;
  const config: Config = { preset: options.preset, board: p.board, homes: p.board === 'croix' ? 4 : 6, mechanics: p.mechanics, teams };
  return {
    config,
    seats: homes.map((home) => ({ home, status: 'playing' })),
    tokens: homes.map(() => Array.from({ length: p.mechanics.tokensPerPlayer }, () => BASE)),
    current: 0,
    phase: 'roll',
    roll: null,
    sixesInRow: 0,
    turnNo: 1,
    ranking: [],
  };
}

function validateTeams(preset: Preset, players: number, teams: number[][]): void {
  const sizes = PRESETS[preset].teamSizes;
  const size = teams[0]!.length;
  if (!sizes.includes(size) || teams.some((t) => t.length !== size)) throw new LudoError('Équipes de taille invalide');
  // Équipes avec un nombre de joueurs impair : combinaison bloquée.
  if (size * teams.length !== players) throw new LudoError('Les équipes doivent couvrir tous les joueurs');
  const all = teams.flat().sort((a, b) => a - b);
  if (all.some((s, i) => s !== i)) throw new LudoError('Chaque siège doit être dans une seule équipe');
}

export function teamOf(state: LudoState, seat: number): number {
  const i = state.config.teams.findIndex((t) => t.includes(seat));
  return i === -1 ? -1 - seat : i;
}

function partners(state: LudoState, a: number, b: number): boolean {
  return a === b || teamOf(state, a) === teamOf(state, b);
}

/** Pions présents sur une case absolue de la piste. */
export function tokensAt(state: LudoState, square: number): { seat: number; token: number }[] {
  const out: { seat: number; token: number }[] = [];
  state.tokens.forEach((list, seat) => {
    if (state.seats[seat]!.status === 'out') return;
    list.forEach((progress, token) => {
      if (absoluteSquare(state.config, state.seats[seat]!.home, progress) === square) out.push({ seat, token });
    });
  });
  return out;
}

export function legalMoves(state: LudoState): LudoMove[] {
  if (state.phase !== 'move' || state.roll === null) return [];
  return movesFor(state, state.current, state.roll);
}

/** Coups possibles pour un siège et une valeur de dé (utilisé aussi par la machine). */
export function movesFor(state: LudoState, seat: number, roll: number): LudoMove[] {
  const { config } = state;
  const home = state.seats[seat]!.home;
  const end = finish(config);
  const moves: LudoMove[] = [];
  state.tokens[seat]!.forEach((from, token) => {
    let to: number;
    if (from === BASE) {
      if (!config.mechanics.exitRolls.includes(roll)) return;
      to = 0;
    } else {
      if (from === end) return;
      to = from + roll;
      // Il faut le chiffre exact pour rentrer.
      if (to > end) return;
    }
    const captures: LudoMove['captures'] = [];
    const square = absoluteSquare(config, home, to);
    if (square !== null && !isSafeSquare(config, square)) {
      for (const t of tokensAt(state, square)) if (!partners(state, seat, t.seat)) captures.push(t);
    }
    moves.push({ token, from, to, captures });
  });
  return moves;
}

/**
 * Coups réellement différents : deux pions à la même place donnent le même
 * résultat. Un seul coup distinct = il peut être joué tout seul.
 */
export function distinctMoves(moves: LudoMove[]): LudoMove[] {
  const seen = new Map<string, LudoMove>();
  for (const m of moves) {
    const key = `${m.from}>${m.to}`;
    if (!seen.has(key)) seen.set(key, m);
  }
  return [...seen.values()];
}

/** Enregistre la valeur du dé pour le joueur au trait. */
export function applyRoll(state: LudoState, value: number): LudoState {
  if (state.phase !== 'roll') throw new LudoError('Ce n’est pas le moment de lancer');
  if (!Number.isInteger(value) || value < 1 || value > 6) throw new LudoError('Valeur de dé invalide');
  const m = state.config.mechanics;
  const sixesInRow = value === 6 ? state.sixesInRow + 1 : 0;
  if (value === 6 && m.sixRollsAgain && sixesInRow >= m.maxSixes) {
    // Trois 6 de suite : le tour passe, sans jouer.
    return endTurn({ ...state, roll: value, sixesInRow: 0 }, false);
  }
  const next: LudoState = { ...state, roll: value, sixesInRow, phase: 'move' };
  if (legalMoves(next).length === 0) {
    return endTurn(next, value === 6 && m.sixRollsAgain);
  }
  return next;
}

/** Joue un coup. Le coup est recherché parmi les coups légaux : le client n'est jamais cru sur parole. */
export function applyMove(state: LudoState, candidate: Pick<LudoMove, 'token'>): LudoState {
  const move = legalMoves(state).find((m) => m.token === candidate.token);
  if (!move) throw new LudoError('Coup illégal');
  const tokens = state.tokens.map((t) => [...t]);
  tokens[state.current]![move.token] = move.to;
  for (const c of move.captures) tokens[c.seat]![c.token] = BASE;

  let seats = state.seats;
  let ranking = state.ranking;
  const end = finish(state.config);
  if (tokens[state.current]!.every((p) => p === end)) {
    seats = seats.map((s, i) => (i === state.current ? { ...s, status: 'finished' } : s));
    ranking = [...ranking, state.current];
  }
  const m = state.config.mechanics;
  const again = (state.roll === 6 && m.sixRollsAgain) || (m.captureGivesRoll && move.captures.length > 0);
  const next: LudoState = { ...state, tokens, seats, ranking };
  return endTurn(next, again && seats[state.current]!.status === 'playing');
}

/** Retire un joueur (absence prolongée, abandon) : ses pions quittent le plateau. */
export function removeSeat(state: LudoState, seat: number): LudoState {
  if (state.seats[seat]!.status !== 'playing') return state;
  const seats = state.seats.map((s, i) => (i === seat ? { ...s, status: 'out' as const } : s));
  const next: LudoState = { ...state, seats };
  if (state.current === seat && state.phase !== 'over') return endTurn({ ...next, sixesInRow: 0 }, false);
  return finalize(next);
}

function endTurn(state: LudoState, rollAgain: boolean): LudoState {
  const done = finalize(state);
  if (done.phase === 'over') return done;
  if (rollAgain) return { ...done, phase: 'roll', roll: null };
  const n = done.seats.length;
  let next = done.current;
  for (let i = 1; i <= n; i++) {
    const c = (done.current + i) % n;
    if (done.seats[c]!.status === 'playing') {
      next = c;
      break;
    }
  }
  return { ...done, current: next, phase: 'roll', roll: null, sixesInRow: 0, turnNo: done.turnNo + 1 };
}

/** Fin de partie : quand un seul camp (joueur ou équipe) peut encore jouer. */
function finalize(state: LudoState): LudoState {
  const playing = state.seats.map((s, i) => ({ s, i })).filter(({ s }) => s.status === 'playing');
  const camps = new Set(playing.map(({ i }) => teamOf(state, i)));
  const teamsMode = state.config.teams.length > 0;
  // En équipes, un camp a gagné quand tous ses membres sont rentrés.
  const teamDone = teamsMode && state.config.teams.some((t) => t.every((s) => state.seats[s]!.status === 'finished'));
  if (camps.size > 1 && !teamDone) return state;
  const ranking = [...state.ranking];
  // Ceux qui jouent encore prennent les places suivantes, par progression totale.
  const rest = playing
    .map(({ i }) => i)
    .filter((i) => !ranking.includes(i))
    .sort((a, b) => totalProgress(state, b) - totalProgress(state, a));
  ranking.push(...rest);
  // Les joueurs sortis en dernier, le dernier sorti devant.
  const out = state.seats.map((s, i) => ({ s, i })).filter(({ s }) => s.status === 'out').map(({ i }) => i);
  ranking.push(...out.filter((i) => !ranking.includes(i)).reverse());
  return { ...state, phase: 'over', roll: null, ranking };
}

export function totalProgress(state: LudoState, seat: number): number {
  return state.tokens[seat]!.reduce((sum, p) => sum + (p === BASE ? 0 : p + 1), 0);
}

/**
 * Classement des équipes : la somme des places de leurs joueurs (planche
 * Compétitions), la plus petite somme devant.
 */
export function teamRanking(state: LudoState): number[] {
  const place = new Map(state.ranking.map((seat, i) => [seat, i + 1]));
  return state.config.teams
    .map((t, i) => ({ i, sum: t.reduce((s, seat) => s + (place.get(seat) ?? state.seats.length), 0) }))
    .sort((a, b) => a.sum - b.sum)
    .map(({ i }) => i);
}
