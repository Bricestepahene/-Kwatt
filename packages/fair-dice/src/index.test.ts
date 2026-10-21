import { describe, expect, it } from 'vitest';
import { bytesToHex, commitment, createClientSeed, createServerSeed, deriveRoll, hexToBytes, verifyGame } from './index.js';

const seed = hexToBytes('00'.repeat(31) + '01');
const salt = hexToBytes('ab'.repeat(16));

describe('dé vérifiable', () => {
  it('est déterministe', () => {
    const a = deriveRoll({ serverSeed: seed, gameId: 'g1', rollIndex: 0, clientSeed: salt });
    expect(deriveRoll({ serverSeed: seed, gameId: 'g1', rollIndex: 0, clientSeed: salt })).toBe(a);
    expect(a).toBeGreaterThanOrEqual(1);
    expect(a).toBeLessThanOrEqual(6);
  });

  it('dépend de la partie, du numéro et du grain de sel', () => {
    const values = new Set<string>();
    for (let i = 0; i < 200; i++) {
      values.add(String(deriveRoll({ serverSeed: seed, gameId: 'g1', rollIndex: i, clientSeed: salt })));
    }
    expect(values.size).toBe(6);
  });

  it('suit une loi uniforme (χ² sur 60 000 lancers)', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    // Graines fixées : le test est reproductible.
    const n = 60000;
    for (let i = 0; i < n; i++) {
      const clientSeed = new Uint8Array(4);
      new DataView(clientSeed.buffer).setUint32(0, i * 2654435761);
      counts[deriveRoll({ serverSeed: seed, gameId: 'stat', rollIndex: i, clientSeed }) - 1]!++;
    }
    const expected = n / 6;
    const chi2 = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    // 5 degrés de liberté : seuil à 0,1 % = 20,52.
    expect(chi2).toBeLessThan(20.52);
  });

  it('la preuve se vérifie, et une valeur modifiée est détectée', () => {
    const server = createServerSeed();
    const rolls = Array.from({ length: 30 }, (_, i) => {
      const clientSeed = createClientSeed();
      return { rollIndex: i, clientSeed: bytesToHex(clientSeed), value: deriveRoll({ serverSeed: server, gameId: 'g2', rollIndex: i, clientSeed }) };
    });
    const proof = { gameId: 'g2', commitment: commitment(server), serverSeed: bytesToHex(server), rolls };
    expect(verifyGame(proof).ok).toBe(true);
    const tampered = rolls.map((r) => (r.rollIndex === 4 ? { ...r, value: (r.value % 6) + 1 } : r));
    expect(verifyGame({ ...proof, rolls: tampered })).toMatchObject({ ok: false, mismatches: [4] });
    expect(verifyGame({ ...proof, commitment: commitment(createServerSeed()) }).commitmentMatches).toBe(false);
  });
});
