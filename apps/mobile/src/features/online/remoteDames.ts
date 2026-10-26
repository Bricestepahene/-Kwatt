/**
 * Partie de dames distante (contrat C3) : l'état vient du serveur (`game.state`), les coups
 * possibles sont calculés par @kwatt/rules-dames pour l'affichage, et le coup choisi part en
 * notation officielle (« 32-28 », « 27x38 »).
 */
import type { GameEventMessage, GameStateMessage } from "@kwatt/protocol";
import {
  findLegal,
  legalMoves,
  parseNotation,
  toNotation,
  type DamesState,
  type Move,
} from "@kwatt/rules-dames";
import { replayNotation } from "../dames/localGame";
import type { GameEvent } from "../game/controller";
import { RemoteGameController } from "./remoteGame";

const seatSide = (seat: number): "w" | "b" => (seat === 0 ? "w" : "b");

export class RemoteDamesController extends RemoteGameController<
  DamesState,
  Move
> {
  readonly family = "dames" as const;
  private last: Move | null = null;

  protected parseState(m: GameStateMessage): DamesState {
    const raw = m.state as DamesState | null;
    if (raw && Array.isArray(raw.board)) return raw;
    // Secours : rejouer la notation (même règles que le serveur).
    return replayNotation(m.variant as DamesState["variant"], m.moves).state;
  }

  protected eventsFor(
    wire: GameEventMessage["event"] | null,
    before: DamesState,
    after: DamesState,
    prev: GameStateMessage,
    next: GameStateMessage,
  ): GameEvent[] {
    const events: GameEvent[] = [];
    if (wire && (wire.kind === "move" || wire.kind === "capture")) {
      const p = wire.params ?? {};
      const move: Move = {
        from: Number(p.from),
        to: Number(p.to),
        path: Array.isArray(p.path)
          ? (p.path as number[])
          : [Number(p.from), Number(p.to)],
        captures: Array.isArray(p.captures) ? (p.captures as number[]) : [],
      };
      this.last = move;
      const promoted = before.board[move.from - 1] !== after.board[move.to - 1];
      events.push({
        kind: promoted ? "promotion" : wire.kind,
        ...(wire.seat !== undefined ? { seat: wire.seat } : {}),
        params: { ...move },
      });
    } else if (wire) {
      events.push({
        kind: wire.kind,
        ...(wire.seat !== undefined ? { seat: wire.seat } : {}),
        ...(wire.params ? { params: wire.params } : {}),
      });
    }
    if (
      next.status !== "playing" &&
      prev.status === "playing" &&
      !events.some((e) => e.kind === "end")
    ) {
      events.push({
        kind: "end",
        params: { reason: next.outcome?.reason ?? "" },
      });
    }
    // Le trait change : « à toi » pour le joueur concerné.
    if (next.status === "playing" && before.turn !== after.turn)
      events.push({ kind: "turn", seat: after.turn === "w" ? 0 : 1 });
    return events;
  }

  lastMove(): Move | null {
    if (this.last) return this.last;
    const text = this.msg?.lastMove;
    if (!text || !this.msg) return null;
    // Après une reprise : retrouver le dernier coup dans la position d'avant.
    try {
      const { state } = replayNotation(
        this.msg.variant as DamesState["variant"],
        this.msg.moves.slice(0, -1),
      );
      this.last = parseNotation(state, text);
    } catch {
      this.last = null;
    }
    return this.last;
  }

  /** Notation de la partie jusqu'ici. */
  history(): readonly string[] {
    return this.msg?.moves ?? [];
  }

  private myTurn(): boolean {
    const s = this.state;
    if (!s || s.result || this.msg?.status !== "playing") return false;
    return this.mySeats().some((seat) => seatSide(seat) === s.turn);
  }

  legalMoves(): Move[] {
    return this.myTurn() ? legalMoves(this.state!) : [];
  }

  play(move: Move): void {
    if (!this.myTurn()) return;
    const legal = findLegal(this.state!, {
      from: move.from,
      to: move.to,
      captures: move.captures,
    });
    if (!legal) return;
    this.sendIntent({ t: "game.move", move: toNotation(legal) });
  }

  /** Proposition de nulle en attente (siège qui propose), ou null. */
  drawOffer(): { seat: number } | null {
    return this.msg?.drawOffer ?? null;
  }

  offerDraw(): void {
    if (this.isSpectator()) return;
    this.deps.ws.send({ t: "game.draw.offer", gameId: this.id });
  }

  answerDraw(accept: boolean): void {
    if (this.isSpectator()) return;
    this.deps.ws.send({ t: "game.draw.answer", gameId: this.id, accept });
  }
}
