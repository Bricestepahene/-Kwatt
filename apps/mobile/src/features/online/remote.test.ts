/**
 * Contrôleurs distants : abonnement, état venu du serveur, événements rendus avec l'état,
 * intentions envoyées avec le dernier `seq`, réabonnement après reconnexion, pendules.
 */
import type { GameStateMessage } from "@kwatt/protocol";
import {
  applyMove,
  initialState,
  legalMoves,
  toNotation,
  type DamesState,
} from "@kwatt/rules-dames";
import {
  applyRoll,
  legalMoves as ludoLegal,
  newGame,
  type LudoState,
} from "@kwatt/rules-ludo";
import { describe, expect, it } from "vitest";
import { WS_RECONNECTED, type WsClient } from "../../api/ws";
import type { WsClientMessage, WsServerMessage } from "../../api/types";
import type { GameEvent } from "../game/controller";
import { RemoteDamesController } from "./remoteDames";
import { RemoteLudoController } from "./remoteLudo";

const GAME = "0b6f3c1e-8a7d-4c2b-9f10-1d2e3f4a5b6c";

/** Faux client temps réel : garde les envois, répond aux abonnements, diffuse à la demande. */
function fakeWs() {
  const handlers = new Map<string, Set<(m: WsServerMessage) => void>>();
  const sent: WsClientMessage[] = [];
  let reply: ((m: WsClientMessage) => Promise<WsServerMessage>) | null = null;
  const client: Pick<WsClient, "on" | "send" | "request"> = {
    on(type, handler) {
      const set = handlers.get(type) ?? new Set();
      set.add(handler as (m: WsServerMessage) => void);
      handlers.set(type, set);
      return () => set.delete(handler as (m: WsServerMessage) => void);
    },
    send(m) {
      sent.push(m);
    },
    request<T extends WsServerMessage>(m: Omit<WsClientMessage, "id">) {
      sent.push(m as WsClientMessage);
      return (
        reply
          ? reply(m as WsClientMessage)
          : Promise.reject(new Error("pas de réponse"))
      ) as Promise<T>;
    },
  };
  return {
    client,
    sent,
    onRequest(fn: (m: WsClientMessage) => Promise<WsServerMessage>) {
      reply = fn;
    },
    push(m: WsServerMessage) {
      for (const h of [...(handlers.get(m.t) ?? [])]) h(m);
    },
  };
}

function damesMsg(
  state: DamesState,
  seq: number,
  extra: Partial<GameStateMessage> = {},
): GameStateMessage {
  return {
    t: "game.state",
    gameId: GAME,
    seq,
    family: "dames",
    variant: "dames10",
    status: "playing",
    state,
    moves: [],
    clocks: {
      "0": { remainingMs: 300_000, running: state.turn === "w" },
      "1": { remainingMs: 300_000, running: state.turn === "b" },
    },
    seats: [
      { seat: 0, userId: "a", pseudo: "Awa", connected: true },
      { seat: 1, userId: "b", pseudo: "Bea", connected: false },
    ],
    mySeats: [0],
    turnDeadline: null,
    lastRoll: null,
    lastMove: null,
    drawOffer: null,
    thinking: false,
    outcome: null,
    diceCommitment: null,
    spectators: 3,
    serverTime: 1_000,
    ...extra,
  };
}

const deps = (ws: ReturnType<typeof fakeWs>, now: { t: number }) => ({
  ws: ws.client,
  now: () => now.t,
  randomHex: (n: number) => "ab".repeat(n),
});

describe("Dames distantes", () => {
  it("attend le premier état, n'applique rien soi-même, rend l'événement avec l'état suivant", async () => {
    const ws = fakeWs();
    const start = initialState("dames10");
    ws.onRequest(async () => damesMsg(start, 0));
    const now = { t: 50_000 };
    const c = new RemoteDamesController(GAME, deps(ws, now));
    await c.ready();
    expect(ws.sent[0]).toMatchObject({ t: "game.subscribe", gameId: GAME });
    expect(c.mySeats()).toEqual([0]);
    expect(c.seats()[1]).toMatchObject({ name: "Bea", connected: false });
    expect(c.spectators()).toBe(3);

    // Coup : envoyé avec le seq connu, l'état ne bouge pas avant la réponse du serveur.
    const move = legalMoves(start)[0]!;
    c.play(move);
    expect(ws.sent.at(-1)).toEqual({
      t: "game.move",
      gameId: GAME,
      seq: 0,
      move: toNotation(move),
    });
    expect(c.getState()).toBe(start);

    const seen: (GameEvent | undefined)[] = [];
    c.subscribe((_, e) => seen.push(e));
    const after = applyMove(start, move);
    ws.push({
      t: "game.event",
      gameId: GAME,
      seq: 1,
      event: {
        kind: "move",
        seat: 0,
        params: { from: move.from, to: move.to, path: move.path, captures: [] },
      },
    });
    ws.push(damesMsg(after, 1, { lastMove: toNotation(move) }));
    expect(c.getState()).toEqual(after);
    expect(seen.map((e) => e?.kind)).toEqual(["move", "turn"]);
    expect(c.lastMove()).toMatchObject({ from: move.from, to: move.to });
    // Plus à moi : aucun coup proposé, et un nouveau coup n'est pas envoyé.
    expect(c.legalMoves()).toEqual([]);

    // Pendule : le temps qui passe est décompté côté appli pour le camp au trait.
    now.t += 2_000;
    expect(c.clock()).toEqual({
      0: { remainingMs: 300_000, running: false },
      1: { remainingMs: 298_000, running: true },
    });

    // Un état en retard (seq plus petit) est ignoré.
    ws.push(damesMsg(start, 0));
    expect(c.getState()).toEqual(after);
    c.dispose();
    expect(ws.sent.at(-1)).toEqual({ t: "game.unsubscribe", gameId: GAME });
  });

  it("partie introuvable : ready() échoue ; reconnexion : réabonnement", async () => {
    const ws = fakeWs();
    ws.onRequest(async () => {
      throw Object.assign(new Error("game.not_found"), {
        code: "game.not_found",
      });
    });
    const missing = new RemoteDamesController(GAME, deps(ws, { t: 0 }));
    await expect(missing.ready()).rejects.toThrow("game.not_found");

    const ws2 = fakeWs();
    ws2.onRequest(async () => damesMsg(initialState("dames10"), 4));
    const c = new RemoteDamesController(GAME, deps(ws2, { t: 0 }));
    await c.ready();
    ws2.push({ t: WS_RECONNECTED });
    expect(ws2.sent.filter((m) => m.t === "game.subscribe")).toHaveLength(2);
  });

  it("spectateur : abonnement « regarder », aucune intention envoyée", async () => {
    const ws = fakeWs();
    ws.onRequest(async () =>
      damesMsg(initialState("dames10"), 2, { mySeats: [] }),
    );
    const c = new RemoteDamesController(GAME, deps(ws, { t: 0 }), {
      spectate: true,
    });
    await c.ready();
    expect(ws.sent[0]).toMatchObject({ spectate: true });
    expect(c.isSpectator()).toBe(true);
    c.play(legalMoves(initialState("dames10"))[0]!);
    c.resign();
    expect(ws.sent).toHaveLength(1);
  });
});

describe("Ludo distant", () => {
  const ludoMsg = (
    state: LudoState,
    seq: number,
    extra: Partial<GameStateMessage> = {},
  ): GameStateMessage => ({
    ...damesMsg(initialState("dames10"), seq),
    family: "ludo",
    variant: "ludo_classique",
    state,
    clocks: null,
    turnDeadline: 31_000,
    serverTime: 1_000,
    ...extra,
  });

  it("lancer avec grain de sel, coup en notation du joueur au trait, temps du tour", async () => {
    const ws = fakeWs();
    const start = newGame({ preset: "classique", players: 2 });
    ws.onRequest(async () => ludoMsg(start, 0));
    const now = { t: 10_000 };
    const c = new RemoteLudoController(GAME, deps(ws, now));
    await c.ready();
    expect(c.canRoll()).toBe(true);
    c.roll();
    expect(ws.sent.at(-1)).toEqual({
      t: "game.roll",
      gameId: GAME,
      seq: 0,
      clientSeed: "ab".repeat(16),
    });
    now.t += 5_000;
    expect(c.clock()).toEqual({ 0: { remainingMs: 25_000, running: true } });

    const rolled = applyRoll(start, 6);
    const seen: (GameEvent | undefined)[] = [];
    c.subscribe((_, e) => seen.push(e));
    ws.push({
      t: "game.event",
      gameId: GAME,
      seq: 1,
      event: { kind: "six", seat: 0, params: { value: 6, passed: false } },
    });
    ws.push(ludoMsg(rolled, 1, { lastRoll: { seat: 0, value: 6 } }));
    expect(seen[0]).toMatchObject({
      kind: "roll",
      seat: 0,
      params: { value: 6 },
    });
    expect(c.canRoll()).toBe(false);
    const moves = c.legalMoves();
    expect(moves.length).toBeGreaterThan(0);
    expect(moves).toEqual(ludoLegal(rolled));
    c.play(moves[0]!);
    expect(ws.sent.at(-1)).toEqual({
      t: "game.move",
      gameId: GAME,
      seq: 1,
      move: String(moves[0]!.token),
    });
    expect(c.lastRoll()).toEqual({ seat: 0, value: 6 });
  });
});
