/** Réglages d'un salon, conditions de lancement, mise d'un défi, statistiques du dé. */
import type { RoomView } from "@kwatt/protocol";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DRAFT,
  checkProof,
  clampStake,
  diceStats,
  draftRequest,
  gameHref,
  isFriendlyVariant,
  predictionShares,
  seatAllowed,
  startState,
  withGame,
  withVariant,
} from "./logic";

describe("réglages du salon", () => {
  it("Dames à 2 seulement ; Pachisi à 4 ; 6 joueurs jusqu’à 6", () => {
    expect(seatAllowed("dames10", 2)).toBe(true);
    expect(seatAllowed("dames10", 3)).toBe(false);
    expect(seatAllowed("ludo_pachisi", 2)).toBe(false);
    expect(seatAllowed("ludo_pachisi", 4)).toBe(true);
    expect(seatAllowed("ludo_six", 6)).toBe(true);
    expect(seatAllowed("ludo_classique", 6)).toBe(false);
  });

  it("changer de jeu ou de variante ramène les places et retire la mise des variantes amicales", () => {
    const ludo = withGame({ ...DEFAULT_DRAFT, stake: 100 }, "ludo");
    expect(ludo).toMatchObject({ variant: "ludo_classique", seats: 4 });
    expect(withVariant(ludo, "ludo_pachisi")).toMatchObject({
      seats: 4,
      stake: 0,
    });
    expect(isFriendlyVariant("ludo_parchis")).toBe(true);
    expect(isFriendlyVariant("ludo_classique")).toBe(false);
    expect(withVariant({ ...ludo, seats: 6 }, "ludo_classique").seats).toBe(4);
  });

  it("requête : pendule aux Dames, temps par tour au Ludo, nom nettoyé", () => {
    expect(draftRequest(DEFAULT_DRAFT, "  Table ")).toMatchObject({
      name: "Table",
      clock: { initialMs: 300_000, incrementMs: 3_000 },
    });
    const r = draftRequest(withGame(DEFAULT_DRAFT, "ludo"), "L");
    expect(r.turnMs).toBe(30_000);
    expect(r).not.toHaveProperty("clock");
  });
});

describe("lancement et défi", () => {
  const room = (patch: Partial<RoomView>): RoomView =>
    ({
      code: "ABCDEF",
      game: "dames",
      variant: "dames10",
      seats: 2,
      status: "open",
      me: { role: "seat", seat: 0, ready: true, isHost: true, canStake: false },
      table: [
        { seat: 0, player: { userId: "a" }, ready: true, keptUntil: null },
        { seat: 1, player: null, ready: false, keptUntil: null },
      ],
      ...patch,
    }) as unknown as RoomView;

  it("l’hôte lance quand la table est pleine (Dames) et que tous sont prêts", () => {
    expect(startState(room({}))).toMatchObject({
      canStart: false,
      reason: "players",
      missing: 1,
    });
    const full = room({
      table: [
        { seat: 0, player: { userId: "a" }, ready: true, keptUntil: null },
        { seat: 1, player: { userId: "b" }, ready: false, keptUntil: null },
      ] as RoomView["table"],
    });
    expect(startState(full).reason).toBe("ready");
    expect(
      startState({
        ...full,
        table: full.table.map((s) => ({ ...s, ready: true })),
      }).canStart,
    ).toBe(true);
    expect(
      startState({ ...full, me: { ...full.me, isHost: false } }).reason,
    ).toBe("not_host");
  });

  it("mise bornée au plafond ; liens de partie", () => {
    expect(clampStake(480, 450)).toBe(450);
    expect(clampStake(-10, 450)).toBe(0);
    expect(gameHref("ludo", "g1", true)).toBe("/ludo/partie/g1?spectate=1");
  });

  it("pronostics : parts arrondies qui font 100", () => {
    const s = predictionShares([
      { seat: 0, total: 100 },
      { seat: 1, total: 50 },
      { seat: 2, total: 50 },
    ]);
    expect([...s.values()].reduce((a, b) => a + b, 0)).toBe(100);
    expect(s.get(0)).toBe(50);
  });
});

describe("dé vérifiable", () => {
  it("compte les 6 par siège, et recalcule la preuve dans l’appli", async () => {
    const { createServerSeed, commitment, deriveRoll, bytesToHex } =
      await import("@kwatt/fair-dice");
    const seed = createServerSeed();
    const gameId = "b0a7c7e2-0000-4000-8000-000000000001";
    const rolls = Array.from({ length: 30 }, (_, i) => {
      const clientSeed = new Uint8Array(16).fill(i);
      return {
        rollIndex: i,
        seat: i % 2,
        clientSeed: bytesToHex(clientSeed),
        value: deriveRoll({
          serverSeed: seed,
          gameId,
          rollIndex: i,
          clientSeed,
        }),
        byMachine: false,
      };
    });
    const proof = {
      gameId,
      kind: "die" as const,
      commitment: commitment(seed),
      serverSeed: bytesToHex(seed),
      rolls,
    };
    expect(checkProof(proof)).toEqual({ state: "ok", count: 30 });
    expect(diceStats(proof).map((s) => s.rolls)).toEqual([15, 15]);
    // Un lancer modifié est repéré.
    const tampered = {
      ...proof,
      rolls: rolls.map((r, i) =>
        i === 3 ? { ...r, value: (r.value % 6) + 1 } : r,
      ),
    };
    expect(checkProof(tampered)).toMatchObject({
      state: "bad",
      mismatches: [3],
    });
    expect(checkProof({ ...proof, serverSeed: null })).toEqual({
      state: "pending",
    });
  });
});
