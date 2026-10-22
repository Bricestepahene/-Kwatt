/** Agent aléatoire : un coup légal au hasard (référence basse du banc d'essai). */
import type { LudoMove, LudoState } from '@kwatt/rules-ludo';
import type { Agent, AgentContext, Decision } from '../types.js';

export function randomAgent(id = 'random@1'): Agent {
  return {
    id,
    choose(_state: LudoState, moves: LudoMove[], ctx: AgentContext): Decision {
      const i = ctx.rng.int(moves.length);
      return { move: moves[i]!, candidates: moves.map((move) => ({ move, score: 1 / moves.length })), stats: {} };
    },
  };
}
