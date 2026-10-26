/**
 * Partie de Ludo distante (contrat C3). Le dé est tiré par le serveur (@kwatt/fair-dice) à
 * partir du secret de la partie, du numéro du lancer et du grain de sel envoyé ici à chaque
 * lancer ; l'appli ne tire jamais le dé d'une partie en ligne.
 *
 * Le temps du tour (30 s, puis la machine joue à ta place) est rendu comme une pendule du
 * siège au trait, pour le minuteur de l'écran de partie.
 */
import type { GameEventMessage, GameStateMessage } from "@kwatt/protocol";
import {
  legalMoves,
  tokenNotation,
  type LudoMove,
  type LudoState,
} from "@kwatt/rules-ludo";
import type { GameEvent, SeatClock } from "../game/controller";
import { RemoteGameController } from "./remoteGame";

const MOVE_KINDS = new Set(["move", "capture", "home", "enter"]);

export class RemoteLudoController extends RemoteGameController<
  LudoState,
  LudoMove
> {
  readonly family = "ludo" as const;

  protected parseState(m: GameStateMessage): LudoState {
    return m.state as LudoState;
  }

  protected eventsFor(
    wire: GameEventMessage["event"] | null,
    before: LudoState,
    after: LudoState,
    prev: GameStateMessage,
    next: GameStateMessage,
  ): GameEvent[] {
    const events: GameEvent[] = [];
    const seat = wire?.seat !== undefined ? { seat: wire.seat } : {};
    if (wire && (wire.kind === "roll" || wire.kind === "six")) {
      events.push({
        kind: "roll",
        ...seat,
        params: {
          value: wire.params?.value,
          ...(wire.params?.shells ? { shells: wire.params.shells } : {}),
        },
      });
    } else if (wire && MOVE_KINDS.has(wire.kind)) {
      const p = wire.params ?? {};
      const captures = Array.isArray(p.captures)
        ? p.captures.length
        : Number(p.captures ?? 0);
      events.push({
        kind: "move",
        ...seat,
        params: {
          seat: p.seat,
          token: p.token,
          from: p.from,
          to: p.to,
          captures,
          home: wire.kind === "home",
        },
      });
    } else if (wire) {
      events.push({
        kind: wire.kind,
        ...seat,
        ...(wire.params ? { params: wire.params } : {}),
      });
    }
    if (
      next.status !== "playing" &&
      prev.status === "playing" &&
      !events.some((e) => e.kind === "end")
    )
      events.push({ kind: "end" });
    if (after.phase !== "over" && after.current !== before.current)
      events.push({ kind: "turn", seat: after.current });
    return events;
  }

  private myTurn(): boolean {
    const s = this.state;
    if (!s || s.phase === "over" || this.msg?.status !== "playing")
      return false;
    return this.mySeats().includes(s.current);
  }

  canRoll(): boolean {
    return this.myTurn() && this.state!.phase === "roll" && !this.isThinking();
  }

  legalMoves(): LudoMove[] {
    if (!this.myTurn() || this.state!.phase !== "move" || this.isThinking())
      return [];
    return legalMoves(this.state!);
  }

  roll(): void {
    if (!this.canRoll()) return;
    this.sendIntent({ t: "game.roll", clientSeed: this.deps.randomHex(16) });
  }

  play(move: LudoMove): void {
    if (!this.myTurn() || this.state!.phase !== "move") return;
    this.sendIntent({ t: "game.move", move: tokenNotation(this.state!, move) });
  }

  lastRoll(): { seat: number; value: number; shells?: boolean[] } | null {
    return this.msg?.lastRoll ?? null;
  }

  /** Temps du tour en cours (siège au trait), d'après l'échéance donnée par le serveur. */
  override clock(): Record<number, SeatClock> | null {
    const m = this.msg;
    if (!m || m.turnDeadline === null || m.status !== "playing" || !this.state)
      return null;
    const left = m.turnDeadline - m.serverTime - this.elapsed();
    return {
      [this.state.current]: { remainingMs: Math.max(0, left), running: true },
    };
  }

  /** Empreinte du dé publiée au début (écran 22). */
  diceCommitment(): string | null {
    return this.msg?.diceCommitment ?? null;
  }
}
