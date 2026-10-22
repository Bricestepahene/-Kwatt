/**
 * Contrôleur de partie (SPEC §9) : contrat commun des écrans de partie
 * (16, 16b, 21, 21b, 21c, 43) et des sources de partie.
 *
 * Un écran de partie ne sait pas d'où vient la partie : il reçoit un
 * contrôleur. Deux familles d'implémentations :
 * - `local` : contre la machine hors connexion (équipes Dames et Ludo), les
 *   moteurs tournent dans l'appli ;
 * - `remote` : salons, ligues, machine en ligne avec pari, regarder une partie
 *   (équipe Parties en ligne), l'état faisant foi vient du serveur
 *   (`game.state` avec `seq`).
 *
 * L'écran affiche toujours `getState()`, calcule les coups possibles avec
 * `legalMoves()` (règles de @kwatt/rules-*), et n'envoie que des intentions
 * (`play`, `roll`, `resign`…). Un contrôleur distant n'applique rien
 * lui-même : il attend le prochain `game.state`.
 */

/** Jeu d'une partie. */
export type GameFamily = 'dames' | 'ludo';

/** Événement d'animation et de son (le serveur envoie des codes, jamais de texte). */
export interface GameEvent {
  /** Ex. `move`, `capture`, `promotion`, `roll`, `six`, `enter`, `home`, `turn`, `draw_offer`, `end`… */
  kind: string;
  /** Siège concerné. */
  seat?: number;
  /** Paramètres libres (nombre de prises, valeur du dé…), traduits par l'appli. */
  params?: Record<string, unknown>;
}

/** Pendule d'un siège. */
export interface SeatClock {
  remainingMs: number;
  running: boolean;
}

/** Joueur assis, tel que l'écran l'affiche. */
export interface SeatInfo {
  seat: number;
  /** `null` pour la machine. */
  userId: string | null;
  name: string;
  /** Machine : niveau affiché (difficulté). */
  machine?: { difficulty: string };
  /** Avatar au format du composant Avatar de @/ui. */
  avatar?: unknown;
  connected?: boolean;
  team?: number;
}

/** Résultat d'une partie, pour l'écran 18 (fin de partie). */
export interface GameOutcome {
  /** Places par siège (1 = gagnant). Dames : nulle = les deux à 1 avec `draw`. */
  places: Record<number, number>;
  draw: boolean;
  /** Code de la raison : `no_moves`, `resign`, `timeout`, `repetition`, `quiet_kings`, `agreement`, `absence`, `all_home`… */
  reason: string;
}

export interface GameController<State, Move> {
  readonly kind: 'local' | 'remote';
  readonly family: GameFamily;
  /** Identifiant de la partie (local : identifiant généré dans l'appli). */
  readonly id: string;

  /** Dernier état faisant foi. */
  getState(): State;
  /** Abonnement aux changements d'état ; renvoie la fonction de désabonnement. */
  subscribe(cb: (state: State, event?: GameEvent) => void): () => void;

  /** Sièges joués par cet appareil (vide pour un spectateur). */
  mySeats(): number[];
  /** Joueurs assis. */
  seats(): SeatInfo[];
  /** Coups légaux pour l'appareil, calculés par @kwatt/rules-*. Vide si ce n'est pas à lui. */
  legalMoves(): Move[];

  /** Joue un coup (local : appliqué ; distant : envoyé, appliqué au prochain état). */
  play(move: Move): void;
  /** Ludo : lancer le dé (ou les cauris). */
  roll?(): void;
  resign(): void;
  /** Dames : proposer la nulle, répondre à une proposition. */
  offerDraw?(): void;
  answerDraw?(accept: boolean): void;
  /** Réaction rapide (clé, ex. `reaction.ekie`). */
  react?(key: string): void;

  /** Pendules par siège, ou `null` sans pendule (contre la machine). */
  clock(): Record<number, SeatClock> | null;
  /** Résultat quand la partie est finie, sinon `null`. */
  outcome(): GameOutcome | null;

  /** Libère les ressources (minuteries, abonnements WebSocket). */
  dispose(): void;
}
