/**
 * Rejeu des parties jouées hors connexion contre la machine (contrat C2, D-08) : le serveur
 * ne croit jamais l'appli sur parole.
 *
 * Dames : le joueur a les blancs (en bas, comme les écrans 16 et 16b ; en 8×8 les noirs, donc
 * la machine, commencent). Chaque coup du joueur doit être légal (@kwatt/rules-dames) ;
 * chaque coup de la machine est recalculé avec `chooseMoveSync` (@kwatt/engine-dames), même
 * force visée et même graine, sans limite de temps : il doit être identique.
 * Partie inachevée = le joueur a abandonné (la machine n'abandonne jamais, et on ne propose
 * pas la nulle à la machine).
 *
 * Ludo : légalité seulement (@kwatt/rules-ludo) ; les lancers hors ligne viennent du
 * téléphone. Format d'un coup : « lancer:pion » (« 6:2 »), « lancer:siège.pion » quand un
 * partenaire joue pour l'autre, « lancer:- » (pas de coup), « b:pion » (coup bonus du
 * Parchís, sans lancer). Le joueur est au siège 0, les machines aux sièges suivants.
 */
import { chooseMoveSync } from '@kwatt/engine-dames';
import {
  applyMove,
  initialState,
  moveKey,
  parseNotation,
  type DamesState,
  type Side,
  type Variant as DamesVariant,
} from '@kwatt/rules-dames';
import {
  applyMove as applyLudoMove,
  applyRoll,
  endOnTime,
  legalMoves as ludoLegalMoves,
  newGame,
  type LudoState,
  type Preset,
} from '@kwatt/rules-ludo';

export const PLAYER_SIDE: Side = 'w';

export class InvalidGameError extends Error {
  constructor(
    readonly ply: number,
    readonly reason: string,
  ) {
    super(`Partie refusée au coup ${ply} : ${reason}`);
  }
}

export interface DamesReplay {
  outcome: 'win' | 'loss' | 'draw';
  /** Raison de la fin (`no_moves`, `repetition`, `quiet_kings`, ou `resign`). */
  reason: string;
  final: DamesState;
}

export function replayDames(variant: DamesVariant, moves: readonly string[], machine: { targetRating: number; seed: number }): DamesReplay {
  let state = initialState(variant);
  for (const [ply, text] of moves.entries()) {
    if (state.result) throw new InvalidGameError(ply, 'after_end');
    const move = parseNotation(state, text);
    if (!move) throw new InvalidGameError(ply, 'illegal');
    if (state.turn !== PLAYER_SIDE) {
      const choice = chooseMoveSync(state, { targetRating: machine.targetRating, seed: machine.seed });
      if (moveKey(choice.move) !== moveKey(move)) throw new InvalidGameError(ply, 'machine_mismatch');
    }
    state = applyMove(state, move);
  }
  if (!state.result) return { outcome: 'loss', reason: 'resign', final: state };
  const winner = state.result.winner;
  return { outcome: winner === null ? 'draw' : winner === PLAYER_SIDE ? 'win' : 'loss', reason: state.result.reason, final: state };
}

const LUDO_PRESETS: Record<string, Preset> = {
  ludo_classique: 'classique',
  ludo_rapide: 'rapide',
  ludo_six: 'six',
  ludo_parchis: 'parchis',
  ludo_pachisi: 'pachisi',
};

export interface LudoReplay {
  outcome: 'win' | 'loss';
  /** Place de chaque siège (1 = premier). Siège 0 : le joueur. */
  places: number[];
  reason: string;
}

const LUDO_MOVE = /^(\d{1,2}|b):(-|\d)(?:\.(\d))?$/;

export function ludoSetup(variant: string, machines: number): { preset: Preset; players: number; teams?: number[][] } {
  const preset = LUDO_PRESETS[variant];
  if (!preset) throw new InvalidGameError(0, 'variant');
  if (preset === 'pachisi') return { preset, players: 4, teams: [[0, 2], [1, 3]] };
  return { preset, players: 1 + machines };
}

export function replayLudo(variant: string, machines: number, moves: readonly string[]): LudoReplay {
  const setup = ludoSetup(variant, machines);
  let state: LudoState;
  try {
    state = newGame(setup);
  } catch {
    throw new InvalidGameError(0, 'setup');
  }
  for (const [ply, text] of moves.entries()) {
    if (state.phase === 'over') throw new InvalidGameError(ply, 'after_end');
    const m = LUDO_MOVE.exec(text);
    if (!m) throw new InvalidGameError(ply, 'format');
    const [, roll, token, tokenOfSeat] = m;
    try {
      if (roll === 'b') {
        if (state.phase !== 'move') throw new InvalidGameError(ply, 'bonus_not_now');
      } else {
        if (state.phase !== 'roll') throw new InvalidGameError(ply, 'roll_not_now');
        state = applyRoll(state, Number(roll));
      }
      if (token === '-') {
        // « Pas de coup » : seulement si aucun coup n'était possible (le tour est déjà passé).
        if (state.phase === 'move' && ludoLegalMoves(state).length > 0) throw new InvalidGameError(ply, 'skipped_move');
      } else {
        if (state.phase !== 'move') throw new InvalidGameError(ply, 'move_not_now');
        const candidate = tokenOfSeat !== undefined ? { seat: Number(token), token: Number(tokenOfSeat) } : { token: Number(token) };
        state = applyLudoMove(state, candidate);
      }
    } catch (err) {
      if (err instanceof InvalidGameError) throw err;
      throw new InvalidGameError(ply, 'illegal');
    }
  }
  let reason = 'all_home';
  if (state.phase !== 'over') {
    if (setup.preset === 'rapide') {
      state = endOnTime(state);
      reason = 'time';
    } else {
      // Partie quittée : le joueur est dernier.
      const n = state.seats.length;
      const places = state.seats.map((_, i) => (i === 0 ? n : i));
      return { outcome: 'loss', places, reason: 'resign' };
    }
  }
  const places = state.seats.map((_, seat) => {
    const i = state.ranking.indexOf(seat);
    return i < 0 ? state.seats.length : i + 1;
  });
  let win = places[0] === 1;
  if (setup.teams) {
    // Pachisi : l'équipe du joueur gagne si sa somme de places est la plus petite.
    const sum = (team: number[]) => team.reduce((s, seat) => s + places[seat]!, 0);
    const mine = setup.teams.find((t) => t.includes(0))!;
    win = setup.teams.every((t) => t === mine || sum(mine) < sum(t));
  }
  return { outcome: win ? 'win' : 'loss', places, reason };
}
