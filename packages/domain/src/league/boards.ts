/**
 * Choix de la planche d'un match (écrans 28b et 34b, planche RegleCompet).
 *
 * Les 4 règles :
 * - imposée : l'organisateur, une fois pour toute la compétition ;
 * - qui reçoit : à l'aller l'un, au retour l'autre, jusqu'à 24 h avant ;
 *   sans choix à temps, la planche par défaut ;
 * - une par journée : le calendrier fait tourner la liste permise ;
 * - commun accord : les deux proposent jusqu'à 24 h avant ; sans accord, la
 *   planche par défaut.
 *
 * Et ce qui est permis où (tableau « Ce qui est permis où »).
 */

export type Board = 'dames10' | 'dames8' | 'ludo_classique' | 'ludo_rapide' | 'ludo_six' | 'ludo_parchis' | 'ludo_pachisi' | 'ludo_house';
export type BoardPolicy = 'imposed' | 'home' | 'rotation' | 'agreement';
export type CompetitionContext = 'public_league' | 'private_league' | 'stake_challenge';

/** Délai : les choix et propositions sont possibles jusqu'à 24 h avant le match. */
export const BOARD_CHOICE_DEADLINE_MS = 24 * 3_600_000;

export interface BoardRules {
  policy: BoardPolicy;
  /** Planches permises (au moins une ; une seule si imposée). */
  allowed: readonly Board[];
  /** Planche par défaut (doit être permise). */
  defaultBoard: Board;
}

export function validateBoardRules(rules: BoardRules, context: CompetitionContext, hasEntryFee: boolean): string | null {
  if (rules.allowed.length === 0) return 'competition.boards_empty';
  if (rules.policy === 'imposed' && rules.allowed.length !== 1) return 'competition.imposed_single_board';
  if (!rules.allowed.includes(rules.defaultBoard)) return 'competition.default_not_allowed';
  for (const b of rules.allowed) if (!boardAllowed(b, context, hasEntryFee)) return 'competition.board_not_allowed';
  return null;
}

/**
 * Tableau « Ce qui est permis où » : Parchís et Pachisi seulement en ligue
 * privée ou coupe ; règles maison seulement en ligue privée sans entrée.
 */
export function boardAllowed(board: Board, context: CompetitionContext, hasEntryFee: boolean): boolean {
  switch (board) {
    case 'dames10':
    case 'dames8':
    case 'ludo_classique':
    case 'ludo_rapide':
    case 'ludo_six':
      return true;
    case 'ludo_parchis':
    case 'ludo_pachisi':
      return context === 'private_league';
    case 'ludo_house':
      return context === 'private_league' && !hasEntryFee;
  }
}

/** Une planche donne-t-elle lieu à un classement (force) ? */
export function boardIsRated(board: Board): boolean {
  return board === 'dames10' || board === 'dames8' || board === 'ludo_classique' || board === 'ludo_rapide' || board === 'ludo_six';
}

export interface Choice {
  board: Board;
  /** Moment où le choix a été fait (ms). */
  at: number;
}

export interface BoardMatchInput {
  rules: BoardRules;
  /** Journée (1, 2, …) : sert à la rotation. */
  round: number;
  /** Heure du match (ms). */
  matchAt: number;
  /** Qui reçoit : son choix (règle « qui reçoit »). */
  hostChoice?: Choice | null;
  /** Propositions des deux joueurs (règle « commun accord »). */
  proposals?: readonly [Choice | null, Choice | null];
}

export interface BoardDecision {
  board: Board;
  /** Pourquoi : choix de qui reçoit, accord, rotation, imposée ou défaut. */
  source: 'imposed' | 'host' | 'rotation' | 'agreement' | 'default';
}

function inTime(c: Choice | null | undefined, rules: BoardRules, matchAt: number): c is Choice {
  return !!c && c.at <= matchAt - BOARD_CHOICE_DEADLINE_MS && rules.allowed.includes(c.board);
}

export function decideBoard(input: BoardMatchInput): BoardDecision {
  const { rules } = input;
  switch (rules.policy) {
    case 'imposed':
      return { board: rules.allowed[0]!, source: 'imposed' };
    case 'rotation': {
      const i = (((input.round - 1) % rules.allowed.length) + rules.allowed.length) % rules.allowed.length;
      return { board: rules.allowed[i]!, source: 'rotation' };
    }
    case 'home':
      return inTime(input.hostChoice, rules, input.matchAt)
        ? { board: input.hostChoice.board, source: 'host' }
        : { board: rules.defaultBoard, source: 'default' };
    case 'agreement': {
      const [a, b] = input.proposals ?? [null, null];
      if (inTime(a, rules, input.matchAt) && inTime(b, rules, input.matchAt) && a.board === b.board) {
        return { board: a.board, source: 'agreement' };
      }
      return { board: rules.defaultBoard, source: 'default' };
    }
  }
}

/** Dernier moment pour choisir ou proposer (24 h avant le match). */
export function boardChoiceDeadline(matchAt: number): number {
  return matchAt - BOARD_CHOICE_DEADLINE_MS;
}
