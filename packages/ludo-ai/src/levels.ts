/**
 * Les 5 difficultés (écran 15) : des agents et des budgets différents, jamais
 * un dé différent. Réglages mesurés au banc d'essai (CALIBRATION.md).
 *
 * - Facile : un débutant. Il avance et mange quand il le voit, ne regarde
 *   pas les menaces, et hésite souvent.
 * - Moyen : un joueur du dimanche. Il voit les menaces à peu près, se trompe parfois.
 * - Coriace : l'heuristique complète, avec la probabilité exacte d'être pris.
 * - Ton niveau : expectimax (lancers suivants pesés exactement).
 * - Fon : expectimax à trois coups (deux au moins), sous budget de temps.
 *   Au banc d'essai, ni la profondeur 3, ni le mode maxn, ni le réglage des
 *   poids ne battent nettement « Ton niveau » en Classique à 2 (50 % sur
 *   600 parties) : au Ludo, le dé plafonne vite l'avantage de la réflexion.
 *   Fon reste au moins aussi fort partout, sans l'écart du MCTS en Six.
 */
import { expectimaxAgent } from './agents/expectimax.js';
import { heuristicAgent } from './agents/heuristic.js';
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
    agent: expectimaxAgent({ depth: 3, minDepth: 2, mode: 'paranoid' }, 'fon@2'),
    budgetMs: 400,
  },
};
