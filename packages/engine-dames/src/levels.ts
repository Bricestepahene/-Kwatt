/**
 * Niveaux humains par échelon (planche Moteur, « Le vrai défi · perdre comme
 * un humain »). Chaque échelon a une force visée, ce qu'il voit et sa façon
 * de se tromper :
 *
 * | Échelon         | Force   | Ce qu'il voit            | Comment il se trompe                         |
 * |-----------------|---------|--------------------------|----------------------------------------------|
 * | Apprenti        | ≈ 800   | les prises d'un coup     | laisse des pions en prise, ne voit pas les rafles |
 * | Débrouillard    | ≈ 1 100 | 2 à 3 coups              | oublie la riposte après sa propre prise      |
 * | Ancien du kwatt | ≈ 1 350 | pièges simples           | structure fragile, fin de partie approximative |
 * | Notable         | ≈ 1 550 | rafles et coups de dame  | rate les combinaisons longues                |
 * | Chef            | ≈ 1 800 | plan à long terme        | rares erreurs de tempo                       |
 * | Fon             | maximum | tout                     | presque jamais                               |
 *
 * Traduction en réglages :
 * - « ce qu'il voit » = profondeur de recherche et quiétude : l'Apprenti
 *   regarde un demi-coup sans les réponses adverses (il laisse des pions en
 *   prise) ; le Débrouillard trois demi-coups sans quiétude (sa propre prise
 *   au bout de la ligne paraît gratuite : il oublie la riposte) ; etc. ;
 * - « comment il se trompe » = bruit sur l'évaluation des coups (choix entre
 *   coups proches) et poids d'évaluation dégradés (structure, finales) ;
 * - « jamais un coup absurde » : une vérification indépendante écarte tout
 *   coup qui perd plus que `cap` (en centièmes de pion) par rapport au
 *   meilleur coup vu par cette vérification. Un Apprenti peut laisser un ou
 *   deux pions, jamais trois ; un Chef ne lâche jamais un pion.
 *
 * Entre deux échelons, les réglages sont interpolés selon la force visée.
 */
import { defaultWeights, type EvalWeights } from './evaluate.js';

export const LEVEL_IDS = ['apprenti', 'debrouillard', 'ancien', 'notable', 'chef', 'fon'] as const;
export type LevelId = (typeof LEVEL_IDS)[number];

export interface LevelProfile {
  /** Échelon le plus proche de la force visée. */
  id: LevelId;
  targetRating: number;
  /** Profondeur de la recherche « de vision », en demi-coups. */
  depth: number;
  /** Demi-coups de quiétude (prises) ; 0 = l'horizon coupe les prises. */
  qDepth: number;
  /** Budget de nœuds de la recherche de vision (déterministe). */
  maxNodes: number;
  /** Écart-type du bruit ajouté au score de chaque coup (centièmes de pion). */
  noise: number;
  /** Perte maximale tolérée par rapport au meilleur coup vérifié (centièmes de pion). */
  cap: number;
  /** Poids de la structure (1 = normal). */
  structureScale: number;
  /** Poids du tempo (1 = normal) : les erreurs de tempo du Chef viennent du bruit sur ce terme. */
  tempoScale: number;
  /** Connaissances de finale. */
  endgame: boolean;
  /** Pleine force : recherche classique, sans bruit ni vérification. */
  full: boolean;
}

interface Anchor {
  rating: number;
  depth: number;
  qDepth: number;
  maxNodes: number;
  noise: number;
  cap: number;
  structureScale: number;
  tempoScale: number;
  endgame: boolean;
}

/** Points d'ancrage (planche Moteur) ; le premier prolonge vers le bas pour la difficulté « Facile ». */
const ANCHORS: readonly Anchor[] = [
  { rating: 400, depth: 1, qDepth: 0, maxNodes: 1_000, noise: 110, cap: 260, structureScale: 0, tempoScale: 0, endgame: false },
  { rating: 800, depth: 1, qDepth: 0, maxNodes: 2_000, noise: 70, cap: 220, structureScale: 0.2, tempoScale: 0.3, endgame: false },
  { rating: 1100, depth: 3, qDepth: 0, maxNodes: 12_000, noise: 40, cap: 160, structureScale: 0.4, tempoScale: 0.5, endgame: false },
  { rating: 1350, depth: 4, qDepth: 4, maxNodes: 40_000, noise: 22, cap: 110, structureScale: 0.3, tempoScale: 0.7, endgame: false },
  { rating: 1550, depth: 6, qDepth: 12, maxNodes: 120_000, noise: 12, cap: 70, structureScale: 1, tempoScale: 1, endgame: true },
  { rating: 1800, depth: 9, qDepth: 40, maxNodes: 400_000, noise: 5, cap: 35, structureScale: 1, tempoScale: 1, endgame: true },
  { rating: 2100, depth: 64, qDepth: 120, maxNodes: 800_000, noise: 0, cap: 0, structureScale: 1, tempoScale: 1, endgame: true },
];

/** Force visée de chaque échelon (planche Moteur) ; Fon = force maximale. */
export const LEVEL_RATINGS: Record<LevelId, number> = {
  apprenti: 800,
  debrouillard: 1100,
  ancien: 1350,
  notable: 1550,
  chef: 1800,
  fon: 2100,
};

/** Échelon dont la force visée est la plus proche. */
export function levelIdFor(rating: number): LevelId {
  let best: LevelId = 'apprenti';
  let gap = Infinity;
  for (const id of LEVEL_IDS) {
    const d = Math.abs(LEVEL_RATINGS[id] - rating);
    if (d < gap) {
      gap = d;
      best = id;
    }
  }
  return best;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Réglages pour une force visée (sans force : pleine force). */
export function levelProfile(targetRating: number | null | undefined): LevelProfile {
  const rating = targetRating ?? Infinity;
  const top = ANCHORS[ANCHORS.length - 1]!;
  if (rating >= top.rating) {
    return { ...top, id: 'fon', targetRating: Number.isFinite(rating) ? rating : top.rating, full: true };
  }
  const lowest = ANCHORS[0]!;
  let a = lowest;
  let b = lowest;
  if (rating <= lowest.rating) {
    a = b = lowest;
  } else {
    for (let i = 1; i < ANCHORS.length; i++) {
      if (rating <= ANCHORS[i]!.rating) {
        a = ANCHORS[i - 1]!;
        b = ANCHORS[i]!;
        break;
      }
    }
  }
  const t = a === b ? 0 : (rating - a.rating) / (b.rating - a.rating);
  // La profondeur ne s'interpole pas jusqu'à 64 : entre Chef et Fon, on va jusqu'à 12.
  const bDepth = b.depth > 20 ? 12 : b.depth;
  const bNodes = b.maxNodes;
  return {
    id: levelIdFor(rating),
    targetRating: rating,
    depth: Math.round(lerp(a.depth, bDepth, t)),
    qDepth: Math.round(lerp(a.qDepth, b.qDepth, t)),
    maxNodes: Math.round(Math.exp(lerp(Math.log(a.maxNodes), Math.log(bNodes), t))),
    noise: lerp(a.noise, b.noise, t),
    cap: Math.round(lerp(a.cap, b.cap, t)),
    structureScale: lerp(a.structureScale, b.structureScale, t),
    tempoScale: lerp(a.tempoScale, b.tempoScale, t),
    endgame: t < 0.5 ? a.endgame : b.endgame,
    full: false,
  };
}

/** Poids d'évaluation d'un niveau. */
export function levelWeights(profile: LevelProfile, size: number): EvalWeights {
  const base = defaultWeights(size);
  return {
    ...base,
    structure: base.structure * profile.structureScale,
    backRank: base.backRank * Math.max(0.3, profile.structureScale),
    tempo: base.tempo * profile.tempoScale,
    endgame: profile.endgame,
  };
}
