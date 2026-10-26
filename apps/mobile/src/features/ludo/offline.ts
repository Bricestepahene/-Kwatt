/**
 * Fin d'une partie de Ludo locale contre la machine : historique local (C4), puis résultat mis
 * dans la file hors ligne commune (`enqueueMachineResult`, C2) s'il compte (profil, sans règles
 * maison). L'envoi et le report du règlement dans l'historique sont ceux de machineResults.ts.
 */
import type { MachineResultRequest } from '@kwatt/protocol';
import { saveLocalGame } from '../game/history';
import type { LocalGame } from '../game/historyStore';
import { enqueueMachineResult } from '../game/machineResults';
import type { LocalLudoOptions } from './local/controller';
import { variantId } from './setup';

/** Corps de POST /v1/machine/results pour une partie locale terminée. */
export function resultRequest(options: LocalLudoOptions, moves: string[]): MachineResultRequest {
  return {
    clientGameId: options.id,
    family: 'ludo',
    variant: variantId(options.setup.preset) as MachineResultRequest['variant'],
    difficulty: options.difficulty,
    mode: options.mode,
    machines: options.machines,
    seed: options.seed,
    moves,
    playedAt: new Date(options.createdAt).toISOString(),
  };
}

export async function recordFinishedGame(game: LocalGame, options: LocalLudoOptions, moves: string[]): Promise<void> {
  await saveLocalGame(game);
  if (options.submit) await enqueueMachineResult(resultRequest(options, moves));
}
