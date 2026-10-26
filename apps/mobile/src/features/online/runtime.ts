/**
 * Branche les parties distantes dans l'appli : fabriques des contrôleurs Dames et Ludo
 * (`setRemoteControllerFactory`), reliées au client temps réel et au hasard de l'appareil.
 * Importé une fois au démarrage (app/_layout.tsx).
 */
import { getRandomValues } from "expo-crypto";
import { ws } from "../../api/client";
import { setRemoteControllerFactory } from "../game/registry";
import type { RemoteDeps } from "./remoteGame";
import { RemoteDamesController } from "./remoteDames";
import { RemoteLudoController } from "./remoteLudo";

function randomHex(bytes: number): string {
  const b = getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const deps: RemoteDeps = { ws, now: () => Date.now(), randomHex };

setRemoteControllerFactory(
  "dames",
  (id, options) => new RemoteDamesController(id, deps, options),
);
setRemoteControllerFactory(
  "ludo",
  (id, options) => new RemoteLudoController(id, deps, options),
);
