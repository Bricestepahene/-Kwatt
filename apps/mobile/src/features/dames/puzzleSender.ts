/**
 * Solution du problème du jour trouvée sans réseau : gardée dans la file hors ligne et
 * envoyée au retour du réseau (POST /v1/puzzles/daily/solve). Le serveur la revalide ; un
 * jour déjà passé est refusé (puzzle.wrong_day) et l'action est abandonnée.
 * Enregistré au démarrage (importé par app/_layout.tsx).
 */
import type { DailyPuzzleSolveRequest, DailyPuzzleSolveResponse } from '@kwatt/protocol';
import { api, queryClient } from '../../api/client';
import { flushOfflineQueue, offlineQueue, registerOfflineSender } from '../../offline';

export const PUZZLE_SOLVE_KIND = 'puzzle.solve';

registerOfflineSender(PUZZLE_SOLVE_KIND, async (action) => {
  await api.post<DailyPuzzleSolveResponse>('/v1/puzzles/daily/solve', action.payload as DailyPuzzleSolveRequest);
  void queryClient.invalidateQueries({ queryKey: ['puzzles'] });
  void queryClient.invalidateQueries({ queryKey: ['wallet'] });
  return 'done';
});

export async function enqueuePuzzleSolve(request: DailyPuzzleSolveRequest): Promise<void> {
  await offlineQueue.enqueue(PUZZLE_SOLVE_KIND, request);
  void flushOfflineQueue();
}
