/**
 * Déroulé d'une partie de Ludo, sans I/O et sans hasard : le lancer (dé ou
 * cauris) est fourni de l'extérieur (tirage vérifiable du serveur). Même état +
 * mêmes lancers = même partie.
 *
 * Un tour : `applyRoll` (valeur du lancer) puis `applyMove` (pion choisi),
 * éventuellement suivis de coups bonus (Parchís : + 20 après une capture,
 * + 10 après une rentrée) et de lancers de plus (6, grâce, capture qui rejoue).
 */
import { LudoError } from './errors.js';
import {
  buildMechanics,
  isGrace,
  isValidThrow,
  normalizeHouseRules,
  PRESETS,
  SEATING,
  TOPOLOGY,
  validateSetup,
  type Config,
  type NewGameOptions,
  type Topology,
} from './variants.js';

export const BASE = -1;

export interface Seat {
  /** Maison (couleur) du siège : index dans `ludoSeats` du design. */
  home: number;
  status: 'playing' | 'finished' | 'out';
}

export interface LudoMove {
  /** Siège à qui appartient le pion (le joueur au trait, ou son partenaire quand il joue pour lui). */
  seat: number;
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
  /** Dernier lancer du joueur au trait (valeur en cases ; cauris : 2 … 6, 10 ou 25). */
  roll: number | null;
  sixesInRow: number;
  turnNo: number;
  /** Sièges dans l'ordre d'arrivée (1er, 2e…). */
  ranking: number[];
  /** Coups bonus à jouer, le premier d'abord (Parchís : 20 après une capture, 10 après une rentrée). */
  bonus: number[];
  /** Le joueur au trait relancera quand ses coups seront joués (6, grâce, capture qui rejoue). */
  extraRoll: boolean;
  /** Dernier pion bougé pendant ce tour (Parchís : trois 6 le renvoient à la base). */
  lastMoved: { seat: number; token: number } | null;
  /** Par siège : la sortie libre du premier pion est encore disponible (Pachisi). */
  freeExit: boolean[];
}

// ---------------------------------------------------------------------------
// Parcours
// ---------------------------------------------------------------------------

export function topologyOf(config: Pick<Config, 'board'>): Topology {
  return TOPOLOGY[config.board];
}

export function trackLength(config: Pick<Config, 'board'>): number {
  return topologyOf(config).trackLength;
}

/** Première progression sur la piste commune (0, sauf au Pachisi : 7). */
export function trackStart(config: Pick<Config, 'board'>): number {
  return topologyOf(config).trackStart;
}

/** Dernière progression sur la piste commune. */
export function lastTrack(config: Pick<Config, 'board'>): number {
  return topologyOf(config).lastTrack;
}

/** Progression d'un pion rentré au centre. */
export function finish(config: Pick<Config, 'board'>): number {
  return topologyOf(config).finish;
}

/** Case absolue de départ (première case de piste) d'une maison. */
export function startSquare(config: Pick<Config, 'board'>, home: number): number {
  const t = topologyOf(config);
  return (t.startOffset + home * t.block) % t.trackLength;
}

/** Case absolue de la piste (0 … longueur − 1) ou null hors piste (base, cases privées, arrivée). */
export function absoluteSquare(config: Pick<Config, 'board'>, home: number, progress: number): number | null {
  const t = topologyOf(config);
  if (progress < t.trackStart || progress > t.lastTrack) return null;
  return (t.startOffset + home * t.block + progress - t.trackStart) % t.trackLength;
}

/** Décalage d'une case absolue depuis le départ de maison qui la précède. */
function offsetInBlock(t: Topology, square: number): number {
  return (((square - t.startOffset) % t.block) + t.block) % t.block;
}

export function isSafeSquare(config: Pick<Config, 'board' | 'mechanics'>, square: number): boolean {
  const t = topologyOf(config);
  const offsets = t.protection[config.mechanics.safeSquares] ?? [];
  return offsets.includes(offsetInBlock(t, square));
}

/** Château du Pachisi (case marquée d'une croix), quelle que soit la protection choisie. */
export function isCastle(config: Pick<Config, 'board'>, square: number): boolean {
  const t = topologyOf(config);
  return t.castles.includes(offsetInBlock(t, square));
}

/** Toutes les cases protégées de la partie (pour le dessin). */
export function protectedSquares(config: Pick<Config, 'board' | 'mechanics'>): number[] {
  const out: number[] = [];
  for (let s = 0; s < trackLength(config); s++) if (isSafeSquare(config, s)) out.push(s);
  return out;
}

/** Une barrière peut-elle se former sur cette case ? */
function barrierSquare(config: Config, square: number): boolean {
  const b = config.mechanics.barriers;
  if (b === 'none') return false;
  if (b === 'castles') return isCastle(config, square);
  return true;
}

/** Nombre maximal de pions sur une case de piste (barrières : 2). */
function capacity(config: Config, square: number): number {
  return barrierSquare(config, square) ? 2 : Infinity;
}

// ---------------------------------------------------------------------------
// Mise en place
// ---------------------------------------------------------------------------

export function newGame(options: NewGameOptions): LudoState {
  const check = validateSetup(options);
  if (!check.ok) throw new LudoError(check.code, check.params);
  const p = PRESETS[options.preset];
  const house = normalizeHouseRules(options.preset, options.house);
  const homes = SEATING[p.board][options.players]!;
  const config: Config = {
    preset: options.preset,
    board: p.board,
    homes: TOPOLOGY[p.board].homes,
    mechanics: buildMechanics(options.preset, house),
    teams: (options.teams ?? []).map((t) => [...t]),
    house,
    timeLimitMs: p.timeLimitMs,
  };
  return {
    config,
    seats: homes.map((home) => ({ home, status: 'playing' })),
    tokens: homes.map(() => Array.from({ length: config.mechanics.tokensPerPlayer }, () => BASE)),
    current: 0,
    phase: 'roll',
    roll: null,
    sixesInRow: 0,
    turnNo: 1,
    ranking: [],
    bonus: [],
    extraRoll: false,
    lastMoved: null,
    freeExit: homes.map(() => config.mechanics.firstExitFree),
  };
}

// ---------------------------------------------------------------------------
// Équipes
// ---------------------------------------------------------------------------

export function teamOf(state: Pick<LudoState, 'config'>, seat: number): number {
  const i = state.config.teams.findIndex((t) => t.includes(seat));
  return i === -1 ? -1 - seat : i;
}

/** Même siège ou même équipe : on ne se mange jamais. */
export function arePartners(state: Pick<LudoState, 'config'>, a: number, b: number): boolean {
  return a === b || teamOf(state, a) === teamOf(state, b);
}

/** Partenaires d'un siège (lui exclu). */
export function partnersOf(state: Pick<LudoState, 'config'>, seat: number): number[] {
  const t = state.config.teams.find((team) => team.includes(seat));
  return t ? t.filter((s) => s !== seat) : [];
}

/**
 * Sièges dont le joueur bouge les pions : les siens ; quand il a tout rentré
 * et que la variante le prévoit, ceux de ses partenaires encore en jeu.
 */
export function controlledSeats(state: LudoState, seat: number): number[] {
  const s = state.seats[seat];
  if (!s) return [];
  if (s.status === 'playing') return [seat];
  if (s.status === 'finished' && state.config.mechanics.partnerPlays) {
    return partnersOf(state, seat).filter((p) => state.seats[p]!.status === 'playing');
  }
  return [];
}

/** Le siège a-t-il encore des tours à jouer ? */
function isActive(state: LudoState, seat: number): boolean {
  return controlledSeats(state, seat).length > 0;
}

// ---------------------------------------------------------------------------
// Coups
// ---------------------------------------------------------------------------

type Occupancy = Map<number, { seat: number; token: number }[]>;

function occupancy(state: LudoState): Occupancy {
  const occ: Occupancy = new Map();
  const { config } = state;
  state.tokens.forEach((list, seat) => {
    const s = state.seats[seat]!;
    if (s.status === 'out') return;
    list.forEach((progress, token) => {
      const sq = absoluteSquare(config, s.home, progress);
      if (sq === null) return;
      const at = occ.get(sq);
      if (at) at.push({ seat, token });
      else occ.set(sq, [{ seat, token }]);
    });
  });
  return occ;
}

/** Pions présents sur une case absolue de la piste. */
export function tokensAt(state: LudoState, square: number): { seat: number; token: number }[] {
  return occupancy(state).get(square) ?? [];
}

function isBarrier(config: Config, occ: Occupancy, square: number): boolean {
  if (!barrierSquare(config, square)) return false;
  const at = occ.get(square);
  if (!at || at.length < 2) return false;
  const count = new Map<number, number>();
  for (const o of at) count.set(o.seat, (count.get(o.seat) ?? 0) + 1);
  return [...count.values()].some((c) => c >= 2);
}

/** Barrières d'un siège : cases de piste où il a deux pions et où une barrière compte. */
export function barriersOf(state: LudoState, seat: number): number[] {
  const occ = occupancy(state);
  const out: number[] = [];
  for (const [sq, at] of occ) {
    if (barrierSquare(state.config, sq) && at.filter((o) => o.seat === seat).length >= 2) out.push(sq);
  }
  return out.sort((a, b) => a - b);
}

/** Un pion peut-il sortir de la base avec cette valeur ? */
function canExit(state: LudoState, owner: number, value: number): boolean {
  const m = state.config.mechanics;
  return m.exitRolls.includes(value) || (m.firstExitFree && state.freeExit[owner] === true);
}

/**
 * Déplacement d'un pion de `steps` cases (ou sortie de la base), avec les
 * barrières, les cases protégées et les captures. null si le coup est impossible.
 */
function tryMove(state: LudoState, occ: Occupancy, owner: number, token: number, steps: number, kind: 'throw' | 'bonus'): LudoMove | null {
  const { config } = state;
  const t = topologyOf(config);
  const home = state.seats[owner]!.home;
  const from = state.tokens[owner]![token]!;

  if (from === BASE) {
    // Un bonus ne sort jamais un pion.
    if (kind === 'bonus' || !canExit(state, owner, steps)) return null;
    const square = absoluteSquare(config, home, 0);
    if (square === null) return { seat: owner, token, from, to: 0, captures: [] };
    const at = occ.get(square) ?? [];
    const opponents = at.filter((o) => !arePartners(state, owner, o.seat));
    if (at.length >= capacity(config, square)) {
      // Départ plein : si un adversaire y est, le pion qui sort le prend (règle du Parchís,
      // qui casse aussi une barrière adverse posée sur un départ) ; sinon on ne sort pas.
      if (opponents.length === 0) return null;
      const victim = [...opponents].sort((a, b) => a.seat - b.seat || a.token - b.token)[0]!;
      return { seat: owner, token, from, to: 0, captures: [victim] };
    }
    if (isSafeSquare(config, square)) {
      if (!config.mechanics.safeShared && opponents.length > 0) return null;
      return { seat: owner, token, from, to: 0, captures: [] };
    }
    return { seat: owner, token, from, to: 0, captures: opponents };
  }

  if (from >= t.finish) return null;
  const to = from + steps;
  // Il faut le chiffre exact pour rentrer.
  if (to > t.finish) return null;
  // Personne ne traverse une barrière (pas même son propriétaire).
  for (let p = from + 1; p < to; p++) {
    const sq = absoluteSquare(config, home, p);
    if (sq !== null && isBarrier(config, occ, sq)) return null;
  }
  const square = absoluteSquare(config, home, to);
  if (square === null) return { seat: owner, token, from, to, captures: [] };
  if (isBarrier(config, occ, square)) return null;
  const at = (occ.get(square) ?? []).filter((o) => !(o.seat === owner && o.token === token));
  if (at.length >= capacity(config, square)) return null;
  const opponents = at.filter((o) => !arePartners(state, owner, o.seat));
  if (isSafeSquare(config, square)) {
    if (!config.mechanics.safeShared && opponents.length > 0) return null;
    return { seat: owner, token, from, to, captures: [] };
  }
  return { seat: owner, token, from, to, captures: opponents };
}

function rawMoves(state: LudoState, seat: number, steps: number, kind: 'throw' | 'bonus'): LudoMove[] {
  const occ = occupancy(state);
  const moves: LudoMove[] = [];
  for (const owner of controlledSeats(state, seat)) {
    state.tokens[owner]!.forEach((_, token) => {
      const m = tryMove(state, occ, owner, token, steps, kind);
      if (m) moves.push(m);
    });
  }
  return moves;
}

/** Coups possibles pour un siège et une valeur de lancer (utilisé aussi par la machine). */
export function movesFor(state: LudoState, seat: number, roll: number): LudoMove[] {
  let moves = rawMoves(state, seat, roll, 'throw');
  const m = state.config.mechanics;
  // Parchís : avec un 5, sortir un pion est obligatoire quand c'est possible.
  if (m.exitForced && m.exitRolls.includes(roll)) {
    const exits = moves.filter((mv) => mv.from === BASE);
    if (exits.length > 0) moves = exits;
  }
  // Un 6 oblige à ouvrir une barrière, quand c'est possible.
  if (m.barriers === 'six_opens' && m.throw === 'dice' && roll === 6) {
    const barriers = new Map(controlledSeats(state, seat).map((s) => [s, barriersOf(state, s)]));
    const opens = moves.filter((mv) => {
      if (mv.from === BASE) return false;
      const sq = absoluteSquare(state.config, state.seats[mv.seat]!.home, mv.from);
      return sq !== null && (barriers.get(mv.seat) ?? []).includes(sq);
    });
    if (opens.length > 0) moves = opens;
  }
  return moves;
}

/** Nombre de cases du coup à jouer maintenant : le bonus en attente, sinon le lancer. */
export function pendingSteps(state: LudoState): number | null {
  if (state.phase !== 'move') return null;
  return state.bonus[0] ?? state.roll;
}

export function legalMoves(state: LudoState): LudoMove[] {
  if (state.phase !== 'move' || state.roll === null) return [];
  const bonus = state.bonus[0];
  if (bonus !== undefined) return rawMoves(state, state.current, bonus, 'bonus');
  return movesFor(state, state.current, state.roll);
}

/**
 * Coups réellement différents : deux pions à la même place donnent le même
 * résultat. Un seul coup distinct = il peut être joué tout seul.
 */
export function distinctMoves(moves: LudoMove[]): LudoMove[] {
  const seen = new Map<string, LudoMove>();
  for (const m of moves) {
    const key = `${m.seat}:${m.from}>${m.to}`;
    if (!seen.has(key)) seen.set(key, m);
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Déroulé
// ---------------------------------------------------------------------------

/** Enregistre la valeur du lancer (dé : 1 à 6 ; cauris : 2 … 6, 10 ou 25) pour le joueur au trait. */
export function applyRoll(state: LudoState, value: number): LudoState {
  if (state.phase !== 'roll') throw new LudoError('ludo.roll.not_now');
  const m = state.config.mechanics;
  if (!isValidThrow(m.throw, value)) throw new LudoError('ludo.roll.invalid_value', { value });
  let sixesInRow = state.sixesInRow;
  let extraRoll = false;
  if (m.throw === 'dice') {
    sixesInRow = value === 6 ? state.sixesInRow + 1 : 0;
    if (value === 6 && m.sixRollsAgain && sixesInRow >= m.maxSixes) {
      // Trois 6 de suite : le tour passe sans jouer (Parchís : le dernier pion bougé rentre à la base).
      let tokens = state.tokens;
      const last = state.lastMoved;
      if (m.thirdSix === 'last_moved_home' && last) {
        const progress = state.tokens[last.seat]![last.token]!;
        const t = topologyOf(state.config);
        // Un pion déjà dans le couloir final (ou rentré) est à l'abri de cette pénalité.
        if (progress >= t.trackStart && progress <= t.lastTrack) {
          tokens = state.tokens.map((list) => [...list]);
          tokens[last.seat]![last.token] = BASE;
        }
      }
      return nextTurn({ ...state, tokens, roll: value, sixesInRow: 0 });
    }
    extraRoll = value === 6 && m.sixRollsAgain;
  } else {
    extraRoll = m.graceRollsAgain && isGrace(value);
  }
  const next: LudoState = { ...state, roll: value, sixesInRow, phase: 'move', bonus: [], extraRoll };
  if (legalMoves(next).length === 0) return continueTurn(next);
  return next;
}

/** Joue un coup. Le coup est recherché parmi les coups légaux : le client n'est jamais cru sur parole. */
export function applyMove(state: LudoState, candidate: Pick<LudoMove, 'token'> & { seat?: number }): LudoState {
  if (state.phase !== 'move') throw new LudoError('ludo.move.not_now');
  const move = legalMoves(state).find((m) => m.token === candidate.token && (candidate.seat === undefined || m.seat === candidate.seat));
  if (!move) throw new LudoError('ludo.move.illegal', { token: candidate.token });
  return applyLegalMove(state, move);
}

/**
 * Applique un coup déjà tiré de `legalMoves(state)`, sans le rechercher :
 * réservé aux simulations (machine, banc d'essai). Le serveur passe par `applyMove`.
 */
export function applyLegalMove(state: LudoState, move: LudoMove): LudoState {
  const m = state.config.mechanics;
  const end = finish(state.config);
  const tokens = state.tokens.map((t) => [...t]);
  tokens[move.seat]![move.token] = move.to;
  for (const c of move.captures) tokens[c.seat]![c.token] = BASE;

  let freeExit = state.freeExit;
  if (move.from === BASE && freeExit[move.seat]) freeExit = freeExit.map((f, i) => (i === move.seat ? false : f));

  let seats = state.seats;
  let ranking = state.ranking;
  if (tokens[move.seat]!.every((p) => p === end)) {
    seats = seats.map((s, i) => (i === move.seat ? { ...s, status: 'finished' as const } : s));
    ranking = [...ranking, move.seat];
  }
  // Le bonus joué quitte la file ; une capture ou une rentrée en ajoute.
  const bonus = state.bonus.length > 0 ? state.bonus.slice(1) : [];
  if (m.captureBonus > 0 && move.captures.length > 0) bonus.push(m.captureBonus);
  if (m.homeBonus > 0 && move.to === end) bonus.push(m.homeBonus);
  const extraRoll = state.extraRoll || (m.captureGivesRoll && move.captures.length > 0);
  return continueTurn({ ...state, tokens, seats, ranking, freeExit, bonus, extraRoll, lastMoved: { seat: move.seat, token: move.token } });
}

/** Après un coup : bonus à jouer, lancer de plus, ou main au suivant. */
function continueTurn(state: LudoState): LudoState {
  const done = finalize(state);
  if (done.phase === 'over') return done;
  if (isActive(done, done.current)) {
    let bonus = done.bonus;
    while (bonus.length > 0) {
      if (rawMoves(done, done.current, bonus[0]!, 'bonus').length > 0) return { ...done, bonus, phase: 'move' };
      // Bonus impossible à jouer : il est perdu.
      bonus = bonus.slice(1);
    }
    if (done.extraRoll) return { ...done, bonus: [], extraRoll: false, phase: 'roll', roll: null };
  }
  return nextTurn(done);
}

function nextTurn(state: LudoState): LudoState {
  const done = finalize(state);
  if (done.phase === 'over') return done;
  const n = done.seats.length;
  let next = done.current;
  for (let i = 1; i <= n; i++) {
    const c = (done.current + i) % n;
    if (isActive(done, c)) {
      next = c;
      break;
    }
  }
  return { ...done, current: next, phase: 'roll', roll: null, sixesInRow: 0, turnNo: done.turnNo + 1, bonus: [], extraRoll: false, lastMoved: null };
}

/** Retire un joueur (absence prolongée, abandon) : ses pions quittent le plateau. */
export function removeSeat(state: LudoState, seat: number): LudoState {
  const s = state.seats[seat];
  if (!s) throw new LudoError('ludo.seat.invalid', { seat });
  if (s.status !== 'playing' || state.phase === 'over') return state;
  const seats = state.seats.map((x, i) => (i === seat ? { ...x, status: 'out' as const } : x));
  const next: LudoState = { ...state, seats };
  if (state.current === seat || !isActive(next, state.current)) return nextTurn(next);
  return finalize(next);
}

/** Fin de partie : quand un seul camp (joueur ou équipe) peut encore jouer, ou quand une équipe a tout rentré. */
function finalize(state: LudoState): LudoState {
  if (state.phase === 'over') return state;
  const playing = state.seats.map((s, i) => ({ s, i })).filter(({ s }) => s.status === 'playing');
  const camps = new Set(playing.map(({ i }) => teamOf(state, i)));
  const teamsMode = state.config.teams.length > 0;
  const teamDone = teamsMode && state.config.teams.some((t) => t.every((s) => state.seats[s]!.status === 'finished'));
  if (camps.size > 1 && !teamDone) return state;
  return close(state);
}

/** Clôt la partie : ceux qui jouent encore sont classés à la progression, les sortis en dernier. */
function close(state: LudoState): LudoState {
  const ranking = [...state.ranking];
  const rest = state.seats
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => s.status === 'playing' && !ranking.includes(i))
    .map(({ i }) => i)
    .sort((a, b) => compareProgress(state, a, b));
  ranking.push(...rest);
  // Les joueurs sortis en dernier, le dernier sorti devant.
  const out = state.seats.map((s, i) => ({ s, i })).filter(({ s }) => s.status === 'out').map(({ i }) => i);
  ranking.push(...out.filter((i) => !ranking.includes(i)).reverse());
  return { ...state, phase: 'over', roll: null, bonus: [], extraRoll: false, ranking };
}

// ---------------------------------------------------------------------------
// Classements
// ---------------------------------------------------------------------------

export function totalProgress(state: LudoState, seat: number): number {
  return state.tokens[seat]!.reduce((sum, p) => sum + (p === BASE ? 0 : p + 1), 0);
}

/**
 * Ordre à la progression : plus de chemin parcouru, puis plus de pions rentrés,
 * puis le pion le plus avancé ; égalité parfaite : l'ordre des sièges.
 */
function compareProgress(state: LudoState, a: number, b: number): number {
  const end = finish(state.config);
  const home = (s: number): number => state.tokens[s]!.filter((p) => p === end).length;
  const best = (s: number): number => Math.max(...state.tokens[s]!);
  return totalProgress(state, b) - totalProgress(state, a) || home(b) - home(a) || best(b) - best(a) || a - b;
}

export interface Standing {
  seat: number;
  /** Place (1 = premier). */
  place: number;
  status: Seat['status'];
  /** Cases parcourues, tous pions confondus. */
  progress: number;
  /** Part du chemin total parcourue (0 à 1). */
  ratio: number;
  tokensHome: number;
}

/**
 * Classement à la progression (fin au temps du Rapide, affichage en cours de partie) :
 * d'abord les arrivés dans l'ordre d'arrivée, puis ceux qui jouent encore à la
 * progression, puis les sortis (le dernier sorti devant).
 */
export function progressStandings(state: LudoState): Standing[] {
  const order = state.phase === 'over' ? state.ranking : close(state).ranking;
  const end = finish(state.config);
  const total = (end + 1) * state.config.mechanics.tokensPerPlayer;
  return order.map((seat, i) => ({
    seat,
    place: i + 1,
    status: state.seats[seat]!.status,
    progress: totalProgress(state, seat),
    ratio: totalProgress(state, seat) / total,
    tokensHome: state.tokens[seat]!.filter((p) => p === end).length,
  }));
}

/** Fin au temps (Rapide, 10 min) : la partie s'arrête et chacun est classé à la progression. */
export function endOnTime(state: LudoState): LudoState {
  if (state.phase === 'over') return state;
  return close(state);
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
