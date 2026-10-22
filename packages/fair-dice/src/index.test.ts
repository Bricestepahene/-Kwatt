import { describe, expect, it } from 'vitest';
import { bytesToHex, commitment, COWRIE_COUNT, createClientSeed, createServerSeed, deriveCowries, deriveRoll, hexToBytes, verifyGame } from './index.js';

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

describe('lancer de 6 cauris vérifiable', () => {
  const input = (i: number): { serverSeed: Uint8Array; gameId: string; rollIndex: number; clientSeed: Uint8Array } => {
    const clientSeed = new Uint8Array(4);
    new DataView(clientSeed.buffer).setUint32(0, i * 2654435761);
    return { serverSeed: seed, gameId: 'cauris', rollIndex: i, clientSeed };
  };

  it('valeurs de référence figées (une preuve publiée doit rester vérifiable)', () => {
    const at = (rollIndex: number): string => deriveCowries({ serverSeed: seed, gameId: 'g1', rollIndex, clientSeed: salt }).pattern;
    expect([0, 1, 2, 3].map(at)).toEqual(['111011', '111111', '111100', '001000']);
    // Le dé garde ses valeurs : l'ajout des cauris ne change rien aux preuves existantes.
    expect([0, 1, 2, 3].map((rollIndex) => deriveRoll({ serverSeed: seed, gameId: 'g1', rollIndex, clientSeed: salt }))).toEqual([6, 2, 2, 3]);
  });

  it('6 cauris, un nombre d’ouvertures cohérent et déterministe', () => {
    const t = deriveCowries(input(5));
    expect(t.shells).toHaveLength(COWRIE_COUNT);
    expect(t.up).toBe(t.shells.filter(Boolean).length);
    expect(t.pattern).toMatch(/^[01]{6}$/);
    expect(deriveCowries(input(5))).toEqual(t);
    expect(() => deriveCowries({ ...input(1), rollIndex: -1 })).toThrow();
  });

  it('chaque cauri tombe à pile ou face sans biais, et les 64 figures sont équiprobables (χ²)', () => {
    const n = 64000;
    const figures = new Array<number>(64).fill(0);
    const perShell = new Array<number>(COWRIE_COUNT).fill(0);
    for (let i = 0; i < n; i++) {
      const t = deriveCowries(input(i));
      figures[parseInt([...t.pattern].reverse().join(''), 2)]!++;
      t.shells.forEach((u, k) => {
        if (u) perShell[k]!++;
      });
    }
    const expected = n / 64;
    const chi2 = figures.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    // 63 degrés de liberté : seuil à 0,1 % ≈ 103,4.
    expect(chi2).toBeLessThan(103.4);
    // Chaque cauri : 50 % à 4 écarts-types près.
    for (const c of perShell) expect(Math.abs(c - n / 2)).toBeLessThan(4 * Math.sqrt(n / 4));
  });

  it('le nombre d’ouvertures suit la loi binomiale B(6, ½) (χ²)', () => {
    const n = 64000;
    const counts = new Array<number>(7).fill(0);
    for (let i = 0; i < n; i++) counts[deriveCowries(input(i + 100000)).up]!++;
    const binom = [1, 6, 15, 20, 15, 6, 1];
    const chi2 = counts.reduce((s, c, k) => {
      const e = (n * binom[k]!) / 64;
      return s + (c - e) ** 2 / e;
    }, 0);
    // 6 degrés de liberté : seuil à 0,1 % = 22,46.
    expect(chi2).toBeLessThan(22.46);
  });

  it('la preuve d’une partie aux cauris se vérifie ; une figure ou un compte modifié est détecté', () => {
    const server = createServerSeed();
    const rolls = Array.from({ length: 30 }, (_, i) => {
      const clientSeed = createClientSeed();
      const t = deriveCowries({ serverSeed: server, gameId: 'p1', rollIndex: i, clientSeed });
      return { rollIndex: i, clientSeed: bytesToHex(clientSeed), value: t.up, pattern: t.pattern };
    });
    const proof = { gameId: 'p1', commitment: commitment(server), serverSeed: bytesToHex(server), rolls, kind: 'cowries' as const };
    expect(verifyGame(proof).ok).toBe(true);
    // Sans le détail des cauris, le compte seul se vérifie aussi.
    expect(verifyGame({ ...proof, rolls: rolls.map(({ rollIndex, clientSeed, value }) => ({ rollIndex, clientSeed, value })) }).ok).toBe(true);
    const wrongCount = rolls.map((r) => (r.rollIndex === 3 ? { ...r, value: (r.value + 1) % 7 } : r));
    expect(verifyGame({ ...proof, rolls: wrongCount })).toMatchObject({ ok: false, mismatches: [3] });
    // Figure modifiée : un cauri retourné.
    const flip = (p: string): string => (p[0] === '1' ? '0' : '1') + p.slice(1);
    const flipped = rolls.map((r) => (r.rollIndex === 7 ? { ...r, pattern: flip(r.pattern) } : r));
    expect(verifyGame({ ...proof, rolls: flipped }).mismatches).toEqual([7]);
    // Une preuve de cauris relue comme une preuve de dé ne passe pas.
    expect(verifyGame({ ...proof, kind: 'die' }).ok).toBe(false);
  });
});
