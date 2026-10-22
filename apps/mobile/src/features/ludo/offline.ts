/**
 * Résultats des parties de Ludo jouées hors connexion contre la machine (contrat C2) :
 * mis dans la file hors ligne, envoyés à POST /v1/machine/results au retour du réseau
 * (idempotent par clientGameId), puis le règlement est reporté dans l'historique local (C4).
 *
 * Type d'action propre au Ludo (« ludo.machine_result ») : l'envoi des Dames reste le leur.
 */
import type { MachineResultRequest, MachineResultResponse } from '@kwatt/protocol';
import { api } from '../../api/client';
import { isApiError } from '../../api/errors';
import { offlineQueue, registerOfflineSender, flushOfflineQueue, type QueuedAction } from '../../offline';
import { saveLocalGame, updateLocalGame, getLocalGame } from '../game/history';
import type { LocalGame } from '../game/historyStore';
import type { LocalLudoOptions } from './local/controller';
import { variantId } from './setup';

export const LUDO_RESULT_KIND = 'ludo.machine_result';

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

async function send(action: QueuedAction) {
  const body = action.payload as MachineResultRequest;
  try {
    const res = await api.post<MachineResultResponse>('/v1/machine/results', body);
    const game = await getLocalGame(body.clientGameId);
    await updateLocalGame(body.clientGameId, {
      settlement: res.settlement,
      rating: res.rating,
      ...(game?.machine ? { machine: { ...game.machine, pending: false, winStreak: res.winStreak } } : {}),
    });
    return 'done' as const;
  } catch (error) {
    if (isApiError(error) && !error.isTransient) {
      // Refusé pour de bon (partie jugée illégale, compte invité…) : on le note dans l'historique.
      const game = await getLocalGame(body.clientGameId);
      if (game?.machine) await updateLocalGame(body.clientGameId, { machine: { ...game.machine, pending: false, rejected: error.code } });
      return 'drop' as const;
    }
    throw error;
  }
}

let registered = false;

/** Branche l'envoi (une fois) : appelé au chargement de l'appli et des écrans du Ludo. */
export function registerLudoOffline(): void {
  if (registered) return;
  registered = true;
  registerOfflineSender(LUDO_RESULT_KIND, send);
}

/** Fin d'une partie locale : historique (C4), puis envoi du résultat si la partie compte. */
export async function recordFinishedGame(game: LocalGame, options: LocalLudoOptions, moves: string[]): Promise<void> {
  registerLudoOffline();
  await saveLocalGame(game);
  if (!options.submit) return;
  await offlineQueue.enqueue(LUDO_RESULT_KIND, resultRequest(options, moves));
  void flushOfflineQueue();
}

registerLudoOffline();
