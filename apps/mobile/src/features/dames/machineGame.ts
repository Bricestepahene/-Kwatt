/**
 * Lancer et reprendre une partie de dames contre la machine sur l'appareil.
 *
 * - `startLocalDames(...)` crée le contrôleur local, l'enregistre (registre des
 *   contrôleurs) et rend son identifiant : l'écran navigue vers /dames/partie/<id>.
 * - `restoreLocalDames(id)` reprend la partie gardée sur l'appareil (appli fermée).
 * - À la fin : la partie va dans l'historique local (C4), puis dans la file hors ligne
 *   vers POST /v1/machine/results (C2) ; le règlement revient dans l'historique.
 */
import { randomUUID } from 'expo-crypto';
import type { Variant } from '@kwatt/rules-dames';
import { localStorage } from '../../storage/deviceStorage';
import { getController, registerController } from '../game/registry';
import { saveLocalGame, type LocalGame } from '../game/history';
import { enqueueMachineResult } from '../game/machineResults';
import { LocalDamesController, newSeed, readLocalDames, type LocalDamesOptions, type MachineDifficulty } from './localGame';

function finisher(options: () => LocalDamesOptions) {
  return async (game: LocalGame) => {
    await saveLocalGame(game);
    const o = options();
    await enqueueMachineResult({
      clientGameId: o.id,
      family: 'dames',
      variant: o.variant,
      difficulty: o.difficulty,
      mode: o.mode,
      seed: o.seed,
      machineRating: o.machineRating,
      moves: game.moves,
      playedAt: game.playedAt,
    });
  };
}

export interface StartLocalDames {
  variant: Variant;
  difficulty: MachineDifficulty;
  mode: 'auto' | 'chosen';
  machineRating: number;
  player: { userId: string | null; name: string; avatar?: unknown };
  machineName: string;
}

export function startLocalDames(input: StartLocalDames): string {
  const options: LocalDamesOptions = {
    id: randomUUID(),
    ...input,
    seed: newSeed(),
    startedAt: new Date().toISOString(),
  };
  const controller = LocalDamesController.start(options, { storage: localStorage, onFinished: finisher(() => options) });
  registerController(controller);
  return options.id;
}

/** Partie locale en cours (gardée sur l'appareil), ou null. */
export async function savedLocalDames(): Promise<{ id: string; variant: Variant } | null> {
  const snap = await readLocalDames(localStorage);
  return snap ? { id: snap.options.id, variant: snap.options.variant } : null;
}

/** Reprend la partie `id` si elle est gardée sur l'appareil ; null sinon. */
export async function restoreLocalDames(id: string): Promise<LocalDamesController | null> {
  const existing = getController(id);
  if (existing instanceof LocalDamesController) return existing;
  const snap = await readLocalDames(localStorage);
  if (!snap || snap.options.id !== id) return null;
  const controller = new LocalDamesController(snap, { storage: localStorage, onFinished: finisher(() => snap.options) });
  registerController(controller);
  controller.resume();
  return controller;
}
