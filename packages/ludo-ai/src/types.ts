import type { LudoMove, LudoState } from '@kwatt/rules-ludo';
import type { Rng } from './rng.js';

/** Les 5 difficultés de l'écran 15 (Défi machine). */
export type Level = 'facile' | 'moyen' | 'coriace' | 'ton_niveau' | 'fon';
export const LEVELS: readonly Level[] = ['facile', 'moyen', 'coriace', 'ton_niveau', 'fon'];

/** Raisons d'un coup, en codes (l'appli les traduit ; jamais de phrase ici). */
export type ReasonCode =
  | 'progress'
  | 'exit'
  | 'capture'
  | 'home'
  | 'corridor'
  | 'safe'
  | 'danger'
  | 'barrier'
  | 'team'
  | 'bonus'
  | 'extra_roll';

export interface Reason {
  code: ReasonCode;
  /** Contribution au score (positive : pour, négative : contre). */
  value: number;
}

export interface Candidate {
  move: LudoMove;
  /** Score du coup pour l'agent (plus haut = meilleur ; échelle propre à l'agent). */
  score: number;
  /** Probabilité que le pion joué soit pris avant ton prochain tour. */
  pCapture?: number;
  /** Probabilité qu'aucun pion de ton camp ne soit pris avant ton prochain tour. */
  pSafe?: number;
  /** Espérance (expectimax : utilité ; MCTS : valeur moyenne des simulations, entre 0 et 1). */
  ev?: number;
  /** MCTS : nombre de simulations passées par ce coup. */
  visits?: number;
  reasons?: Reason[];
}

export interface SearchStats {
  nodes?: number;
  sims?: number;
  depth?: number;
  elapsedMs: number;
}

export interface Decision {
  move: LudoMove;
  candidates: Candidate[];
  stats: Omit<SearchStats, 'elapsedMs'>;
}

export interface AgentContext {
  /** Siège pour lequel la machine joue (le joueur au trait). */
  seat: number;
  rng: Rng;
  now: () => number;
  /** Heure limite (même horloge que `now`). */
  deadline: number;
  /** Plafond d'itérations (simulations, nœuds) : rend la recherche reproductible sans horloge. */
  maxIterations?: number;
}

export interface Agent {
  readonly id: string;
  /** Choisit parmi des coups distincts (non vides) de la position. */
  choose(state: LudoState, moves: LudoMove[], ctx: AgentContext): Decision;
}
