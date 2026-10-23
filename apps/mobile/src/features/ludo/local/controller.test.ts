import { distinctMoves, legalMoves, replayNotation, type LudoState } from '@kwatt/rules-ludo';
import { describe, expect, it } from 'vitest';
import { memoryStore } from '../../../storage/kv';
import type { GameEvent } from '../../game/controller';
import type { LocalGame } from '../../game/historyStore';
import { gameOptions } from '../setup';
import { LocalLudoController, LOCAL_LUDO_KEY, readLocalLudo, type LocalLudoDeps, type LocalLudoOptions } from './controller';
import { throwFor, type ByteSource } from './dice';

/** Octets pseudo-aléatoires reproductibles. */
function bytesFrom(seed: number): ByteSource {
  let s = seed >>> 0;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      out[i] = s >>> 24;
    }
    return out;
  };
}

interface Harness {
  deps: LocalLudoDeps;
  run(): boolean;
  pending(): number;
  clock: { t: number };
  finished: LocalGame[];
  storage: ReturnType<typeof memoryStore>;
}

function harness(seed = 1, opts: { auto?: boolean } = {}): Harness {
  const queue: { fn: () => void; at: number; id: number }[] = [];
  let ids = 0;
  const clock = { t: 0 };
  const finished: LocalGame[] = [];
  const storage = memoryStore();
  const bytes = bytesFrom(seed);
  const deps: LocalLudoDeps = {
    storage,
    throwDice: (kind) => throwFor(kind, bytes),
    now: () => clock.t,
    schedule: (fn, ms) => {
      const id = ++ids;
      queue.push({ fn, at: clock.t + ms, id });
      return () => {
        const i = queue.findIndex((q) => q.id === id);
        if (i >= 0) queue.splice(i, 1);
      };
    },
    autoPlaySingleMove: () => opts.auto ?? true,
    delays: () => ({ roll: 10, move: 10, auto: 10 }),
    // Machine simple et reproductible : le pion le plus avancé.
    chooseMove: (state) => [...legalMoves(state)].sort((a, b) => b.to - a.to)[0]!,
    onFinished: (g) => finished.push(g),
  };
  return {
    deps,
    clock,
    finished,
    storage,
    pending: () => queue.length,
    run() {
      queue.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = queue.shift();
      if (!next) return false;
      clock.t = Math.max(clock.t, next.at);
      next.fn();
      return true;
    },
  };
}

function options(partial: Partial<LocalLudoOptions> = {}): LocalLudoOptions {
  return {
    id: 'local-1',
    setup: { preset: 'classique', house: null },
    machines: 1,
    difficulty: 'moyen',
    mode: 'chosen',
    seed: 42,
    names: ['Toi', 'Machine 1', 'Machine 2', 'Machine 3'],
    submit: true,
    createdAt: Date.UTC(2026, 9, 22, 12),
    ...partial,
  };
}

/** Joue la partie jusqu'au bout : le joueur lance et joue son premier coup légal. */
function playOut(c: LocalLudoController, h: Harness, maxSteps = 20_000): void {
  for (let i = 0; i < maxSteps && c.outcome() === null; i++) {
    if (c.canRoll()) {
      c.roll();
      continue;
    }
    const moves = c.legalMoves();
    if (moves.length > 0) {
      c.play(moves[0]!);
      continue;
    }
    if (!h.run()) break;
  }
}

describe('LocalLudoController', () => {
  it.each([
    ['classique', 1],
    ['classique', 3],
    ['rapide', 2],
    ['six', 3],
    ['parchis', 3],
    ['pachisi', 3],
  ] as const)('%s contre %i machine(s) : la partie va au bout et sa notation la rejoue', (preset, machines) => {
    const h = harness(7 + machines);
    const c = new LocalLudoController(options({ setup: { preset, house: null }, machines }), h.deps);
    c.start();
    playOut(c, h);
    const outcome = c.outcome();
    expect(outcome).not.toBeNull();
    expect(Object.keys(outcome!.places)).toHaveLength(c.getState().seats.length);
    expect(h.finished).toHaveLength(1);
    const game = h.finished[0]!;
    expect(game).toMatchObject({ id: 'local-1', family: 'ludo', variant: `ludo_${preset}`, context: 'machine', mySeats: [0] });
    expect(game.machine).toMatchObject({ difficulty: 'moyen', bet: 0, offline: true, pending: true });
    // Le serveur rejoue la même notation (contrat C2).
    const replayed = replayNotation(gameOptions({ preset, house: null }, machines), game.moves);
    if (preset !== 'rapide') expect(replayed.phase).toBe('over');
    expect(replayed.tokens).toEqual(c.getState().phase === 'over' && preset === 'rapide' ? replayed.tokens : c.getState().tokens);
  });

  it('règles maison : gardées dans l’historique, la notation se rejoue avec elles (écran 19)', () => {
    const house = { capture: 'home_bonus20', barriers: 'six_opens' } as const;
    const h = harness(21);
    const c = new LocalLudoController(options({ setup: { preset: 'classique', house }, machines: 1 }), h.deps);
    c.start();
    playOut(c, h);
    const game = h.finished[0]!;
    expect(game.house).toEqual(house);
    const replayed = replayNotation(gameOptions({ preset: 'classique', house: game.house ?? null }, 1), game.moves);
    expect(replayed.tokens).toEqual(c.getState().tokens);
  });

  it('la machine joue toute seule, le joueur attend son tour', () => {
    const h = harness(3);
    const c = new LocalLudoController(options(), h.deps);
    const events: GameEvent[] = [];
    c.subscribe((_, e) => e && events.push(e));
    c.start();
    expect(c.canRoll()).toBe(true);
    c.roll();
    expect(events[0]).toMatchObject({ kind: 'roll', seat: 0 });
    // Tant que le tour n'est pas revenu, les minuteries font jouer la machine.
    let guard = 0;
    while (!c.canRoll() && c.legalMoves().length === 0 && guard++ < 200) h.run();
    expect(events.some((e) => e.seat === 1 && e.kind === 'roll')).toBe(true);
  });

  it('coup unique : joué pour toi (préférence), sinon il attend', () => {
    // On cherche un lancer qui laisse un seul coup distinct au joueur.
    for (const auto of [true, false]) {
      let found = false;
      for (let seed = 1; seed < 400 && !found; seed++) {
        const h = harness(seed, { auto });
        const c = new LocalLudoController(options(), h.deps);
        c.start();
        for (let i = 0; i < 400 && !found && c.outcome() === null; i++) {
          if (c.canRoll()) {
            c.roll();
            const s: LudoState = c.getState();
            if (s.current === 0 && s.phase === 'move' && distinctMoves(legalMoves(s)).length === 1) {
              found = true;
              if (auto) {
                expect(c.legalMoves()).toEqual([]);
                const events: GameEvent[] = [];
                c.subscribe((_, e) => e && events.push(e));
                h.run();
                expect(events[0]).toMatchObject({ kind: 'move', params: { auto: true } });
              } else {
                expect(c.legalMoves().length).toBeGreaterThan(0);
                expect(h.pending()).toBe(0);
              }
            }
          } else if (c.legalMoves().length > 0) c.play(c.legalMoves()[0]!);
          else if (!h.run()) break;
        }
      }
      expect(found).toBe(true);
    }
  });

  it('sauvegarde après chaque pas et reprend la partie à l’identique', async () => {
    const h = harness(11);
    const c = new LocalLudoController(options(), h.deps);
    c.start();
    for (let i = 0; i < 60; i++) {
      if (c.canRoll()) c.roll();
      else if (c.legalMoves().length > 0) c.play(c.legalMoves()[0]!);
      else h.run();
    }
    await Promise.resolve();
    const snap = await readLocalLudo(h.storage);
    expect(snap).not.toBeNull();
    expect(snap!.moves).toEqual(c.moves());
    const resumed = new LocalLudoController(snap!.options, h.deps, snap!);
    expect(resumed.getState()).toEqual(c.getState());
  });

  it('abandon : partie finie, le joueur dernier, sauvegarde effacée', async () => {
    const h = harness(5);
    const c = new LocalLudoController(options({ machines: 2 }), h.deps);
    c.start();
    c.roll();
    c.resign();
    expect(c.outcome()).toMatchObject({ reason: 'resign', places: { 0: 3 } });
    expect(c.moves()[c.moves().length - 1]).toBe('x:0');
    expect(h.finished).toHaveLength(1);
    await Promise.resolve();
    expect(await h.storage.getItem(LOCAL_LUDO_KEY)).toBeNull();
  });

  it('Rapide : fin au temps après 10 minutes de jeu', () => {
    const h = harness(9);
    const c = new LocalLudoController(options({ setup: { preset: 'rapide', house: null } }), h.deps);
    c.start();
    expect(c.timeLeftMs()).toBe(10 * 60 * 1000);
    h.clock.t = 10 * 60 * 1000 + 1;
    // La vérification programmée arrête la partie, classement à la progression.
    while (c.outcome() === null && h.run());
    expect(c.outcome()?.reason).toBe('time');
  });

  it('règles maison : jouées en local, jamais envoyées', () => {
    const h = harness(2);
    const c = new LocalLudoController(options({ setup: { preset: 'classique', house: { capture: 'home_roll_again' } }, submit: false }), h.deps);
    c.start();
    playOut(c, h);
    expect(h.finished[0]?.machine?.pending).toBe(false);
    expect(c.getState().config.house).toEqual({ capture: 'home_roll_again' });
  });
});
