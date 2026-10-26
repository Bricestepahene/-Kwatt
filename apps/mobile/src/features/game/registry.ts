/**
 * Registre des contrôleurs de partie.
 *
 * - Une partie locale (machine hors connexion) est créée par l'écran de
 *   lancement, enregistrée ici avec `registerController`, puis l'appli navigue
 *   vers `/dames/partie/<id>` ou `/ludo/partie/<id>`.
 * - Une partie distante (salon, ligue, machine en ligne, regarder) n'est pas
 *   enregistrée à l'avance : l'écran de partie appelle `resolveController`,
 *   qui la crée avec la fabrique distante déclarée par l'équipe Parties en
 *   ligne (`setRemoteControllerFactory`).
 */
import type { GameController, GameFamily } from './controller';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyController = GameController<any, any>;
type RemoteFactory = (id: string, options?: { spectate?: boolean }) => AnyController;

const controllers = new Map<string, AnyController>();
const remoteFactories = new Map<GameFamily, RemoteFactory>();

export function registerController(controller: AnyController): void {
  controllers.set(controller.id, controller);
}

export function unregisterController(id: string): void {
  const c = controllers.get(id);
  controllers.delete(id);
  c?.dispose();
}

export function getController(id: string): AnyController | undefined {
  return controllers.get(id);
}

export function setRemoteControllerFactory(family: GameFamily, factory: RemoteFactory): void {
  remoteFactories.set(family, factory);
}

/**
 * Contrôleur d'une partie : celui déjà enregistré (partie locale), sinon un
 * contrôleur distant créé et enregistré. `undefined` si aucune fabrique
 * distante n'est déclarée pour ce jeu.
 */
export function resolveController(family: GameFamily, id: string, options?: { spectate?: boolean }): AnyController | undefined {
  const existing = controllers.get(id);
  if (existing) return existing;
  const factory = remoteFactories.get(family);
  if (!factory) return undefined;
  const created = factory(id, options);
  controllers.set(id, created);
  return created;
}

/**
 * Comme `resolveController`, mais attend le premier état d'une partie distante (`ready()`)
 * avant de rendre le contrôleur : l'écran ne dessine jamais un plateau provisoire.
 * Partie introuvable ou refusée : `undefined` (le contrôleur est libéré).
 */
export async function resolveControllerReady(family: GameFamily, id: string, options?: { spectate?: boolean }): Promise<AnyController | undefined> {
  const c = resolveController(family, id, options) as (AnyController & { ready?: () => Promise<void> }) | undefined;
  if (!c?.ready) return c;
  try {
    await c.ready();
    return c;
  } catch {
    unregisterController(id);
    return undefined;
  }
}
