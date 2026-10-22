/**
 * Les 5 difficultés (écran 15) : des agents et des budgets différents, jamais
 * un dé différent. Réglages mesurés au banc d'essai (CALIBRATION.md).
 *
 * - Facile : un débutant. Il avance et mange quand il le voit, ne regarde
 *   pas les menaces, et hésite souvent.
 * - Moyen : un joueur du dimanche. Il voit les menaces à peu près, se trompe parfois.
 * - Coriace : l'heuristique complète, avec la probabilité exacte d'être pris.
 * - Ton niveau : expectimax (lancers suivants pesés exactement).
 * - Fon : MCTS sous budget de temps, le plus fort mesuré.
 */
import { expectimaxAgent } from './agents/expectimax.js';
import { heuristicAgent } from './agents/heuristic.js';
import { mctsAgent } from './agents/mcts.js';
import type { Agent, Level } from './types.js';

export interface LevelSpec {
  /** Fabrique de l'agent (un agent est sans état : on peut le réutiliser). */
  agent: Agent;
  /** Budget de réflexion par défaut (ms) ; 0 = pas de recherche au temps. */
  budgetMs: number;
}

export const LEVEL_SPECS: Record<Level, LevelSpec> = {
  facile: {
    agent: heuristicAgent(
      { threats: 'none', temperature: 0.35, weights: { danger: 0, safe: 0, barrier: 0, team: 0, corridor: 0.1, exit: 0.5 } },
      'facile@1',
    ),
    budgetMs: 0,
  },
  moyen: {
    agent: heuristicAgent({ threats: 'fast', temperature: 0.08 }, 'moyen@1'),
    budgetMs: 0,
  },
  coriace: {
    agent: heuristicAgent({ threats: 'exact' }, 'coriace@1'),
    budgetMs: 0,
  },
  ton_niveau: {
    agent: expectimaxAgent({ depth: 2, mode: 'paranoid' }, 'ton_niveau@1'),
    budgetMs: 150,
  },
  fon: {
    agent: mctsAgent({}, 'fon@1'),
    budgetMs: 400,
  },
};
