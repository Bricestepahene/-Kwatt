/**
 * La machine sur le serveur : sièges machine (partie contre la machine en ligne) et tours
 * joués à la place d'un joueur de Ludo trop lent (30 s).
 *
 * - Dames : @kwatt/engine-dames `chooseMove`, asynchrone et découpé en tranches : la boucle
 *   du serveur n'est jamais bloquée. Force visée = celle de l'offre (C2), graine de la partie.
 * - Ludo : le service `ludo-ai` (LUDO_AI_URL) s'il répond vite, sinon @kwatt/ludo-ai dans le
 *   processus avec un petit budget. La machine reçoit la position APRÈS le lancer : elle ne
 *   touche jamais au dé (aucun moteur n'importe @kwatt/fair-dice).
 */
import { chooseMove as chooseDames, mixSeed } from '@kwatt/engine-dames';
import { chooseMove as chooseLudoLocal, type Level } from '@kwatt/ludo-ai';
import type { DamesState } from '@kwatt/rules-dames';
import type { LudoMove, LudoState } from '@kwatt/rules-ludo';

/** Garde-fou de réflexion de la machine aux Dames (ms). */
export const DAMES_MACHINE_TIME_MS = 3_000;
/** Budget local du Ludo (le service a le sien). */
export const LUDO_LOCAL_BUDGET_MS = 150;
const LUDO_REMOTE_TIMEOUT_MS = 1_500;

export interface MachinePlayer {
  dames(state: DamesState, options: { targetRating: number | null; seed: number }): Promise<string>;
  ludo(state: LudoState, options: { level: Level; seed: number }): Promise<LudoMove>;
}

export function createMachinePlayer(options: { ludoAiUrl: string | null; log?: { warn(o: object, m: string): void } }): MachinePlayer {
  return {
    async dames(state, { targetRating, seed }) {
      const choice = await chooseDames(state, {
        ...(targetRating !== null ? { targetRating } : {}),
        seed: mixSeed(seed, state.ply),
        timeMs: DAMES_MACHINE_TIME_MS,
      });
      return choice.notation;
    },
    async ludo(state, { level, seed }) {
      if (options.ludoAiUrl) {
        try {
          const res = await fetch(`${options.ludoAiUrl.replace(/\/$/, '')}/v1/choose`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ state, level, seed }),
            signal: AbortSignal.timeout(LUDO_REMOTE_TIMEOUT_MS),
          });
          if (res.ok) {
            const body = (await res.json()) as { move?: LudoMove };
            if (body.move) return body.move;
          }
        } catch (err) {
          options.log?.warn({ err }, 'service ludo-ai injoignable : repli dans le processus');
        }
      }
      return chooseLudoLocal({ state, level, seed, budgetMs: LUDO_LOCAL_BUDGET_MS }).move;
    },
  };
}
