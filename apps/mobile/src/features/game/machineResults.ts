/**
 * Résultats des parties contre la machine jouées hors connexion (contrat C2, D-08) :
 * mis dans la file hors ligne, envoyés au retour du réseau (POST /v1/machine/results,
 * idempotent par clientGameId), puis recopiés dans l'historique local (C4) pour l'écran 18.
 *
 * Dames et Ludo :
 *   await enqueueMachineResult({ clientGameId, family, variant, difficulty, mode, seed, moves, playedAt, machines?, machineRating? });
 *
 * L'envoi est enregistré dès l'import de ce module (importé par app/_layout.tsx).
 */
import type { MachineResultRequest, MachineResultResponse } from '@kwatt/protocol';
import { api, queryClient } from '../../api/client';
import { isApiError } from '../../api/errors';
import { flushOfflineQueue, offlineQueue, registerOfflineSender, type QueuedAction } from '../../offline';
import { getLocalGame, updateLocalGame } from './history';

export const MACHINE_RESULT_KIND = 'machine.result';

/** Recopie le règlement du serveur dans la partie gardée sur l'appareil. */
export async function applyMachineResponse(clientGameId: string, response: MachineResultResponse): Promise<void> {
  const game = await getLocalGame(clientGameId);
  await updateLocalGame(clientGameId, {
    settlement: response.settlement,
    rating: response.rating,
    ...(game?.machine ? { machine: { ...game.machine, pending: false, winStreak: response.winStreak } } : {}),
  });
}

async function send(action: QueuedAction): Promise<'done' | 'drop'> {
  const body = action.payload as MachineResultRequest;
  try {
    const response = await api.post<MachineResultResponse>('/v1/machine/results', body);
    await applyMachineResponse(body.clientGameId, response);
    void queryClient.invalidateQueries({ queryKey: ['machine'] });
    void queryClient.invalidateQueries({ queryKey: ['ratings'] });
    void queryClient.invalidateQueries({ queryKey: ['profile'] });
    return 'done';
  } catch (error) {
    if (isApiError(error) && !error.isTransient) {
      // Refusée pour de bon (partie illégale…) : on le note sur la partie, sans réessayer.
      const game = await getLocalGame(body.clientGameId);
      if (game?.machine) await updateLocalGame(body.clientGameId, { machine: { ...game.machine, pending: false, rejected: error.code } });
      return 'drop';
    }
    throw error;
  }
}

registerOfflineSender(MACHINE_RESULT_KIND, send);

/** Met le résultat dans la file et tente l'envoi tout de suite. */
export async function enqueueMachineResult(request: MachineResultRequest): Promise<void> {
  await offlineQueue.enqueue(MACHINE_RESULT_KIND, request);
  void flushOfflineQueue();
}
