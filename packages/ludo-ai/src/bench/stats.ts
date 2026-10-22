/**
 * Statistiques du banc d'essai : intervalle de confiance d'un taux de
 * victoires, écart de force façon Elo, test séquentiel (SPRT).
 */

/** z pour un intervalle à 95 %. */
export const Z95 = 1.959963984540054;

/** Intervalle de Wilson d'une proportion (succès sur n). */
export function wilson(successes: number, n: number, z = Z95): { p: number; low: number; high: number } {
  if (n === 0) return { p: 0, low: 0, high: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, low: successes === 0 ? 0 : Math.max(0, center - half), high: successes === n ? 1 : Math.min(1, center + half) };
}

/** Moyenne et intervalle à 95 % (loi normale) d'une série de scores. */
export function meanInterval(values: readonly number[], z = Z95): { mean: number; low: number; high: number; sd: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, low: 0, high: 0, sd: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const half = (z * sd) / Math.sqrt(n);
  return { mean, low: mean - half, high: mean + half, sd };
}

/** Écart de force façon Elo correspondant à un score (0 < s < 1) : 400 · log10(s / (1 − s)). */
export function eloFromScore(score: number): number {
  const s = Math.min(0.999, Math.max(0.001, score));
  return 400 * Math.log10(s / (1 - s));
}

export type SprtVerdict = 'H0' | 'H1' | 'continue';

export interface SprtOptions {
  /** Taux sous H0 (pas d'amélioration) et sous H1 (amélioration). */
  p0: number;
  p1: number;
  alpha?: number;
  beta?: number;
}

/**
 * Test séquentiel du rapport de vraisemblance (Wald) sur des résultats 0/1 :
 * accepter H1 (la nouvelle version est meilleure), accepter H0, ou continuer.
 */
export class Sprt {
  readonly lower: number;
  readonly upper: number;
  llr = 0;
  n = 0;
  private readonly win: number;
  private readonly loss: number;

  constructor(readonly options: SprtOptions) {
    const alpha = options.alpha ?? 0.05;
    const beta = options.beta ?? 0.05;
    if (!(options.p0 > 0 && options.p1 < 1 && options.p0 < options.p1)) throw new Error('SPRT : 0 < p0 < p1 < 1');
    this.lower = Math.log(beta / (1 - alpha));
    this.upper = Math.log((1 - beta) / alpha);
    this.win = Math.log(options.p1 / options.p0);
    this.loss = Math.log((1 - options.p1) / (1 - options.p0));
  }

  /** Ajoute un résultat (1 = victoire, 0 = défaite, entre les deux = score partiel). */
  add(score: number): SprtVerdict {
    this.n++;
    this.llr += score * this.win + (1 - score) * this.loss;
    return this.verdict();
  }

  verdict(): SprtVerdict {
    if (this.llr >= this.upper) return 'H1';
    if (this.llr <= this.lower) return 'H0';
    return 'continue';
  }
}
