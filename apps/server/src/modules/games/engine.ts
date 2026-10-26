/**
 * Règles d'une partie en ligne, vues par l'acteur de partie : une couche fine et pure au-dessus
 * de @kwatt/rules-dames et @kwatt/rules-ludo (aucune I/O, aucune horloge, aucun hasard : le
 * lancer arrive de l'extérieur, déjà tiré par le dé vérifiable).
 *
 * - Dames : siège 0 = blancs, siège 1 = noirs. Un coup = notation officielle.
 * - Ludo : siège = place à table. Un coup = le pion, vu du joueur au trait (« 2 », « 1.3 »).
 *   La notation (contrat C2) s'écrit au fil de l'eau : « 6:2 », « 3:- », « b:0 », « x:1 ».
 */
import {
  agreeDraw,
  applyMove as applyDamesMove,
  countPieces,
  initialState,
  legalMoves as damesLegalMoves,
  parseNotation,
  resign as resignDames,
  timeout as timeoutDames,
  toNotation,
  type DamesState,
  type Move,
  type Variant as DamesVariant,
} from '@kwatt/rules-dames';
import {
  applyMove as applyLudoMove,
  applyRoll,
  distinctMoves,
  emptyLog,
  endOnTime,
  finish,
  legalMoves as ludoLegalMoves,
  newGame,
  recordMove,
  recordQuit,
  recordRoll,
  removeSeat,
  replayNotation,
  teamRanking,
  tokenNotation,
  type HouseRules,
  type LudoMove,
  type LudoState,
  type NewGameOptions,
  type NotationLog,
  type Preset,
} from '@kwatt/rules-ludo';

export type Family = 'dames' | 'ludo';

export interface Outcome {
  /** Place par siège (1 = premier) ; nulle aux Dames : tout le monde à 1. */
  places: Record<number, number>;
  draw: boolean;
  reason: string;
}

export const DAMES_VARIANTS: readonly DamesVariant[] = ['dames10', 'dames8'];

export const LUDO_PRESET_OF: Record<string, Preset> = {
  ludo_classique: 'classique',
  ludo_rapide: 'rapide',
  ludo_six: 'six',
  ludo_parchis: 'parchis',
  ludo_pachisi: 'pachisi',
};

export function familyOf(variant: string): Family {
  if ((DAMES_VARIANTS as readonly string[]).includes(variant)) return 'dames';
  if (variant in LUDO_PRESET_OF) return 'ludo';
  throw new Error(`Variante inconnue : ${variant}`);
}

/** Proposer la nulle : une fois tous les 10 coups (20 demi-coups) au plus, par joueur. */
export const DRAW_OFFER_EVERY_PLIES = 20;

/* ------------------------------------------------------------------ */
/* Dames                                                               */
/* ------------------------------------------------------------------ */

export const damesSideOf = (seat: number): 'w' | 'b' => (seat === 0 ? 'w' : 'b');
export const damesSeatOf = (side: 'w' | 'b'): number => (side === 'w' ? 0 : 1);

export class DamesRules {
  readonly family = 'dames' as const;
  state: DamesState;
  readonly moves: string[] = [];

  constructor(readonly variant: DamesVariant) {
    this.state = initialState(variant);
  }

  /** Rejoue une partie depuis sa notation (reprise après redémarrage). */
  static replay(variant: DamesVariant, moves: readonly string[]): DamesRules {
    const r = new DamesRules(variant);
    for (const m of moves) {
      if (!r.play(r.turnSeat() ?? -1, m)) throw new Error(`Rejeu impossible au coup ${r.moves.length + 1} : ${m}`);
    }
    return r;
  }

  over(): boolean {
    return this.state.result !== null;
  }

  turnSeat(): number | null {
    return this.over() ? null : damesSeatOf(this.state.turn);
  }

  /** Joue un coup en notation officielle ; renvoie le coup et sa notation normalisée, ou null s'il est illégal. */
  play(seat: number, text: string): { notation: string; move: Move } | null {
    if (this.over() || seat !== this.turnSeat()) return null;
    const move = parseNotation(this.state, text.trim());
    if (!move) return null;
    this.state = applyDamesMove(this.state, move);
    const notation = toNotation(move);
    this.moves.push(notation);
    return { notation, move };
  }

  legalCount(): number {
    return this.over() ? 0 : damesLegalMoves(this.state).length;
  }

  resign(seat: number): void {
    if (!this.over()) this.state = resignDames(this.state, damesSideOf(seat));
  }

  timeout(seat: number): void {
    if (!this.over()) this.state = timeoutDames(this.state, damesSideOf(seat));
  }

  agreeDraw(): void {
    if (!this.over()) this.state = agreeDraw(this.state);
  }

  /** Résultat ; `reason` remplace celle des règles (abandon par absence : `absence`). */
  outcome(reason?: string): Outcome | null {
    const r = this.state.result;
    if (!r) return null;
    if (r.winner === null) return { places: { 0: 1, 1: 1 }, draw: true, reason: reason ?? r.reason };
    const w = damesSeatOf(r.winner);
    return { places: { [w]: 1, [1 - w]: 2 }, draw: false, reason: reason ?? r.reason };
  }

  /** Départage des ligues : pièces des blancs − pièces des noirs. */
  pieceDiff(): number {
    return countPieces(this.state, 'w') - countPieces(this.state, 'b');
  }

  /** Progression affichée (/regarder) : demi-coups joués. */
  progress(): number {
    return this.state.ply;
  }
}

/* ------------------------------------------------------------------ */
/* Ludo                                                                */
/* ------------------------------------------------------------------ */

export interface LudoSetup {
  variant: string;
  players: number;
  /** Équipes (sièges face à face) ; Pachisi : toujours [[0, 2], [1, 3]]. */
  teams?: number[][] | null;
  house?: Record<string, string> | null;
}

export function ludoOptions(setup: LudoSetup): NewGameOptions {
  const preset = LUDO_PRESET_OF[setup.variant];
  if (!preset) throw new Error(`Variante de Ludo inconnue : ${setup.variant}`);
  const teams = preset === 'pachisi' ? [[0, 2], [1, 3]] : setup.teams;
  return {
    preset,
    players: setup.players,
    ...(teams && teams.length > 0 ? { teams } : {}),
    ...(setup.house ? { house: setup.house as unknown as HouseRules } : {}),
  };
}

/** Équipes face à face pour `players` joueurs (2 contre 2, ou 3 équipes de 2 à 6). */
export function facingTeams(players: number): number[][] {
  const half = players / 2;
  return Array.from({ length: half }, (_, i) => [i, i + half]);
}

export interface RollResult {
  value: number;
  /** Le lancer n'a donné aucun coup : le tour est passé (« 3:- »). */
  passed: boolean;
  /** Coups possibles (distincts) après le lancer. */
  choices: LudoMove[];
}

export class LudoRules {
  readonly family = 'ludo' as const;
  state: LudoState;
  private log: NotationLog = emptyLog();

  constructor(readonly options: NewGameOptions) {
    this.state = newGame(options);
  }

  /** Rejoue la notation et un lancer en attente (reprise après redémarrage). */
  static replay(options: NewGameOptions, moves: readonly string[], pendingRoll: number | null): LudoRules {
    const r = new LudoRules(options);
    r.state = replayNotation(options, moves, pendingRoll);
    r.log = { moves: [...moves], pendingRoll };
    return r;
  }

  get moves(): string[] {
    return this.log.moves;
  }

  get pendingRoll(): number | null {
    return this.log.pendingRoll;
  }

  over(): boolean {
    return this.state.phase === 'over';
  }

  turnSeat(): number | null {
    return this.over() ? null : this.state.current;
  }

  phase(): LudoState['phase'] {
    return this.state.phase;
  }

  /** Lancer (déjà tiré) du joueur au trait. */
  roll(value: number): RollResult {
    if (this.state.phase !== 'roll') throw new Error('Lancer hors de son moment');
    const after = applyRoll(this.state, value);
    this.log = recordRoll(this.log, after, value);
    this.state = after;
    const passed = after.phase !== 'move';
    return { value, passed, choices: passed ? [] : this.choices() };
  }

  /** Coups distincts possibles maintenant. */
  choices(): LudoMove[] {
    return this.state.phase === 'move' ? distinctMoves(ludoLegalMoves(this.state)) : [];
  }

  /** Trouve le coup désigné par « pion » ou « siège.pion » (vu du joueur au trait). */
  findMove(text: string): LudoMove | null {
    if (this.state.phase !== 'move') return null;
    const m = /^(\d)(?:\.(\d))?$/.exec(text.trim());
    if (!m) return null;
    const seat = m[2] !== undefined ? Number(m[1]) : this.state.current;
    const token = Number(m[2] ?? m[1]);
    return ludoLegalMoves(this.state).find((x) => x.seat === seat && x.token === token) ?? null;
  }

  /** Joue un coup légal ; renvoie l'entrée de notation écrite (« 6:2 », « b:0 »). */
  play(move: LudoMove): string {
    const before = this.state;
    this.log = recordMove(this.log, before, move);
    this.state = applyLudoMove(before, { seat: move.seat, token: move.token });
    return this.log.moves[this.log.moves.length - 1]!;
  }

  /** Un joueur quitte la partie (abandon, absence de plus de 60 s) : « x:siège ». */
  quit(seat: number): string | null {
    const s = this.state.seats[seat];
    if (!s || s.status !== 'playing' || this.over()) return null;
    this.log = recordQuit(this.log, seat);
    this.state = removeSeat(this.state, seat);
    return `x:${seat}`;
  }

  /** Fin au temps (Rapide) : classement à la progression. */
  endOnTime(): void {
    this.state = endOnTime(this.state);
  }

  timeLimitMs(): number | null {
    return this.state.config.timeLimitMs;
  }

  isOut(seat: number): boolean {
    return this.state.seats[seat]?.status === 'out';
  }

  outcome(reason?: string): Outcome | null {
    if (!this.over()) return null;
    const places: Record<number, number> = {};
    this.state.ranking.forEach((seat, i) => {
      places[seat] = i + 1;
    });
    return { places, draw: false, reason: reason ?? 'all_home' };
  }

  /** Sièges gagnants : le premier, ou toute l'équipe classée première. */
  winners(): number[] {
    if (!this.over()) return [];
    if (this.state.config.teams.length > 0) {
      const best = teamRanking(this.state)[0];
      return best === undefined ? [] : [...(this.state.config.teams[best] ?? [])];
    }
    const first = this.state.ranking[0];
    return first === undefined ? [] : [first];
  }

  tokensHome(): Record<number, number> {
    const end = finish(this.state.config);
    return Object.fromEntries(this.state.tokens.map((t, seat) => [seat, t.filter((p) => p === end).length]));
  }

  progress(): number {
    return this.state.turnNo;
  }

  tokenNotation(move: LudoMove): string {
    return tokenNotation(this.state, move);
  }
}

export type GameRules = DamesRules | LudoRules;
