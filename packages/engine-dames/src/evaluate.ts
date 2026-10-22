/**
 * Évaluation statique d'une position, en centièmes de pion (100 = un pion),
 * du point de vue des blancs, puis du camp au trait pour la recherche.
 *
 * Termes (planche Moteur, « Évaluation ») :
 * - matériel : pions et dames ;
 * - avancement : pions proches de la promotion (percée) ;
 * - centre : pièces au centre du damier ;
 * - structure : pions soutenus par derrière, pions de bord moins actifs ;
 * - arrière : pions qui gardent la dernière ligne (empêchent la dame adverse) ;
 * - mobilité : coups libres de chaque camp ;
 * - tempo : avance totale des pions, mauvaise en ouverture (pions trop
 *   avancés), bonne en finale (course à la dame) ;
 * - connaissances de finale : fins de dames presque toujours nulles.
 *
 * L'évaluation « apprise » de la planche viendra plus tard (réseau entraîné
 * en auto-jeu) ; celle-ci est écrite à la main, avec des poids réglables par
 * niveau (les échelons bas ignorent la structure et les finales).
 */
import { BK, BM, WK, WM, type Position } from './core.js';

export interface EvalWeights {
  man: number;
  king: number;
  advancement: number;
  center: number;
  structure: number;
  backRank: number;
  mobility: number;
  tempo: number;
  /** Bonus d'une dame sur la grande diagonale (10×10) ou au centre (8×8). */
  kingPlacement: number;
  /** Connaissances de finale (fins de dames nulles). */
  endgame: boolean;
}

export const WEIGHTS_10: EvalWeights = {
  man: 100,
  king: 320,
  advancement: 3,
  center: 4,
  structure: 4,
  backRank: 6,
  mobility: 2,
  tempo: 2,
  kingPlacement: 12,
  endgame: true,
};

export const WEIGHTS_8: EvalWeights = {
  man: 100,
  king: 145,
  advancement: 3,
  center: 5,
  structure: 4,
  backRank: 8,
  mobility: 2,
  tempo: 2,
  kingPlacement: 6,
  endgame: true,
};

export function defaultWeights(size: number): EvalWeights {
  return size === 10 ? WEIGHTS_10 : WEIGHTS_8;
}

/** Bonus d'avancement selon les lignes parcourues (percée près de la promotion). */
const ADVANCE_10 = [0, 0, 0, 1, 2, 4, 7, 11, 16, 0];
const ADVANCE_8 = [0, 0, 1, 2, 4, 7, 11, 0];

export interface EvalTerms {
  material: number;
  advancement: number;
  center: number;
  structure: number;
  backRank: number;
  mobility: number;
  tempo: number;
  kingPlacement: number;
  /** Facteur appliqué au total par les connaissances de finale (1 = aucun). */
  endgameScale: number;
  /** Total, du point de vue des blancs. */
  total: number;
}

/** Évaluation détaillée, du point de vue des blancs. */
export function evaluateTerms(pos: Position, w: EvalWeights = defaultWeights(pos.g.size)): EvalTerms {
  const { b, g } = pos;
  const size = g.size;
  const last = size - 1;
  const adv = size === 10 ? ADVANCE_10 : ADVANCE_8;
  const pieces = pos.wm + pos.wk + pos.bm + pos.bk;
  const start = size === 10 ? 40 : 24;
  // Phase : 1 au début, 0 quand le damier est vide.
  const phase = Math.min(1, pieces / start);

  let advancement = 0;
  let center = 0;
  let structure = 0;
  let backRank = 0;
  let mobility = 0;
  let tempoW = 0;
  let tempoB = 0;
  let kingPlacement = 0;
  const lo = size === 10 ? 3 : 2;
  const hi = last - lo;

  for (let s = 1; s <= g.n; s++) {
    const p = b[s]!;
    if (p === 0) continue;
    const r = g.row[s]!;
    const c = g.col[s]!;
    const rays = g.rays[s]!;
    const sign = p > 0 ? 1 : -1;
    const central = r >= lo && r <= hi && c >= lo && c <= hi;
    if (p === WM || p === BM) {
      // Lignes parcourues depuis la ligne de départ du camp.
      const advanced = p === WM ? last - r : r;
      advancement += sign * adv[advanced]!;
      if (p === WM) tempoW += advanced;
      else tempoB += advanced;
      if (central) center += sign;
      // Soutien : une pièce amie sur une case juste derrière (ou le bord du damier).
      const back = p === WM ? [2, 3] : [0, 1];
      let support = 0;
      for (const d of back) {
        const behind = rays[d]![0];
        if (behind === undefined || b[behind]! * sign > 0) support++;
      }
      structure += sign * (support === 2 ? 2 : support);
      if (c === 0 || c === last) structure -= sign;
      if (advanced === 0) backRank += sign;
      // Mobilité : cases libres vers l'avant.
      const fwd = p === WM ? g.forward[0] : g.forward[1];
      for (const d of fwd) {
        const to = rays[d]![0];
        if (to !== undefined && b[to] === 0) mobility += sign;
      }
    } else {
      if (central) center += sign;
      let free = 0;
      for (let d = 0; d < 4; d++) {
        const ray = rays[d]!;
        for (let j = 0; j < ray.length; j++) {
          if (b[ray[j]!] !== 0) break;
          free++;
          if (!g.flying) break;
        }
      }
      mobility += sign * Math.min(free, 8) * 0.5;
      // Grande diagonale (10×10) : de la case 5 à la case 46 ; au 8×8, le centre.
      const onMain = size === 10 ? r + c === last : central;
      if (onMain) kingPlacement += sign;
    }
  }

  const material = w.man * (pos.wm - pos.bm) + w.king * (pos.wk - pos.bk);
  const men = pos.wm + pos.bm;
  // Tempo : avance moyenne par pion, comparée ; négatif en ouverture, positif en finale.
  const tempoDiff = (pos.wm ? tempoW / pos.wm : 0) - (pos.bm ? tempoB / pos.bm : 0);
  const tempo = men > 0 ? tempoDiff * (0.5 - phase) * 4 : 0;

  const terms = {
    material,
    advancement: w.advancement * advancement * (1.2 - 0.5 * phase),
    center: w.center * center * phase,
    structure: w.structure * structure * phase,
    backRank: w.backRank * backRank * phase,
    mobility: w.mobility * mobility,
    tempo: w.tempo * tempo,
    kingPlacement: w.kingPlacement * kingPlacement,
  };
  let total = terms.material + terms.advancement + terms.center + terms.structure + terms.backRank + terms.mobility + terms.tempo + terms.kingPlacement;
  const endgameScale = w.endgame ? endgameFactor(pos) : 1;
  total *= endgameScale;
  // Arrondi symétrique (½ s'éloigne de zéro) : retourner le damier change exactement le signe.
  const rounded = Math.sign(total) * Math.round(Math.abs(total));
  return { ...terms, endgameScale, total: rounded === 0 ? 0 : rounded };
}

/**
 * Fins de partie presque toujours nulles : dames seules contre une dame seule
 * (10×10 : jusqu'à 3 dames contre 1 si la dame seule tient la grande
 * diagonale ; on réduit fortement l'écart), égalité de dames seules.
 */
export function endgameFactor(pos: Position): number {
  const wTotal = pos.wm + pos.wk;
  const bTotal = pos.bm + pos.bk;
  if (pos.wm === 0 && pos.bm === 0 && wTotal === bTotal) return 0;
  if (pos.g.size === 10) {
    const lone = (men: number, kings: number): boolean => men === 0 && kings === 1;
    if (lone(pos.bm, pos.bk) && pos.wm === 0 && wTotal <= 3) return wTotal <= 2 ? 1 / 16 : 1 / 4;
    if (lone(pos.wm, pos.wk) && pos.bm === 0 && bTotal <= 3) return bTotal <= 2 ? 1 / 16 : 1 / 4;
  } else if (pos.wm === 0 && pos.bm === 0 && wTotal === 1 && bTotal === 1) {
    return 0;
  }
  return 1;
}

/** Évaluation du point de vue du camp au trait (pour la recherche). */
export function evaluate(pos: Position, w: EvalWeights): number {
  const t = evaluateTerms(pos, w).total;
  return pos.stm === 1 ? t : -t;
}

/** Pièces de chaque camp (pour l'analyse : prises, rafles). */
export function material(pos: Position): { white: number; black: number } {
  return { white: pos.wm + pos.wk, black: pos.bm + pos.bk };
}
