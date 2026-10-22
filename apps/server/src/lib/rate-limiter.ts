/**
 * Limiteur en mémoire par clé (fenêtre glissante), pour les limites « par compte »
 * (5 essais de connexion par minute et par compte…). La limite par adresse IP est
 * assurée par @fastify/rate-limit. Un seul processus serveur en V1 (D-02) : la mémoire suffit.
 */
import type { Clock } from './clock.js';
import { AppError } from './errors.js';
import type { ErrorCode } from '@kwatt/protocol';

export class KeyedRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
    private readonly code: ErrorCode = 'auth.too_many_attempts',
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length === 0) this.hits.delete(key);
    else this.hits.set(key, list);
    return list;
  }

  /** Compte un essai ; lève une AppError 429 si la limite est dépassée. */
  hit(key: string): void {
    const now = this.clock.now().getTime();
    const list = this.recent(key, now);
    if (list.length >= this.max) {
      const oldest = list[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      throw new AppError(this.code, 429, { retryAfterSeconds });
    }
    list.push(now);
    this.hits.set(key, list);
    this.prune(now);
  }

  /** Oublie les essais d'une clé (connexion réussie, nouveau code demandé…). */
  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Évite que la table grossisse sans fin. */
  private prune(now: number): void {
    if (this.hits.size < 10_000) return;
    for (const key of [...this.hits.keys()]) this.recent(key, now);
  }
}
