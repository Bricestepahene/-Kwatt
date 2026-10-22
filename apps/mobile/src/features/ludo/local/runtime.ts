/**
 * Parties locales dans l'appli : dépendances réelles du contrôleur (stockage de l'appareil,
 * expo-crypto, préférences, minuteries), création, reprise et enregistrement dans le
 * registre des contrôleurs (src/features/game/registry.ts).
 */
import { getRandomValues } from 'expo-crypto';
import { getPreferences } from '../../../preferences';
import { localStorage } from '../../../storage/deviceStorage';
import { getController, registerController } from '../../game/registry';
import { recordFinishedGame } from '../offline';
import { LocalLudoController, readLocalLudo, type LocalLudoDeps, type LocalLudoOptions } from './controller';
import { throwFor } from './dice';

/** Pauses de la machine selon l'animation du dé (normale, rapide, aucune). */
export function machineDelays(): { roll: number; move: number; auto: number } {
  const anim = getPreferences().diceAnimation;
  if (anim === 'none') return { roll: 350, move: 450, auto: 500 };
  if (anim === 'fast') return { roll: 500, move: 550, auto: 650 };
  return { roll: 800, move: 750, auto: 1000 };
}

function deps(): LocalLudoDeps {
  let controller: LocalLudoController | null = null;
  const d: LocalLudoDeps = {
    storage: localStorage,
    throwDice: (kind) => throwFor(kind, (n) => getRandomValues(new Uint8Array(n))),
    now: () => Date.now(),
    schedule: (fn, ms) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    },
    autoPlaySingleMove: () => getPreferences().autoPlaySingleMove,
    delays: machineDelays,
    onFinished: (game) => {
      if (controller) void recordFinishedGame(game, controller.options, game.moves);
    },
  };
  return Object.assign(d, {
    bind(c: LocalLudoController) {
      controller = c;
    },
  });
}

/** Nouvelle partie locale, enregistrée dans le registre et lancée. */
export function startLocalLudo(options: LocalLudoOptions): LocalLudoController {
  const d = deps() as LocalLudoDeps & { bind(c: LocalLudoController): void };
  const c = new LocalLudoController(options, d);
  d.bind(c);
  registerController(c);
  c.start();
  return c;
}

/**
 * Contrôleur d'une partie locale : déjà en mémoire, sinon repris de la sauvegarde de
 * l'appareil (même identifiant), sinon `undefined`.
 */
export async function resumeLocalLudo(id: string): Promise<LocalLudoController | undefined> {
  const existing = getController(id);
  if (existing instanceof LocalLudoController) return existing;
  const snap = await readLocalLudo(localStorage);
  if (!snap || snap.options.id !== id) return undefined;
  const d = deps() as LocalLudoDeps & { bind(c: LocalLudoController): void };
  let c: LocalLudoController;
  try {
    c = new LocalLudoController(snap.options, d, snap);
  } catch {
    // Sauvegarde illisible (règles changées entre deux versions) : on l'abandonne.
    await localStorage.removeItem('kwatt.ludo.local.v1').catch(() => undefined);
    return undefined;
  }
  d.bind(c);
  registerController(c);
  c.start();
  return c;
}

/** Partie locale sauvegardée (pour « Reprendre » sur l'écran 20). */
export async function savedLocalLudo(): Promise<LocalLudoOptions | null> {
  const snap = await readLocalLudo(localStorage);
  return snap ? snap.options : null;
}
