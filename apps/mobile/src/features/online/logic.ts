/**
 * Règles d'affichage des parties en ligne (sans React) : réglages d'un salon (écran 24),
 * places et file (25), mise d'un défi (26), statistiques du dé (22), parties en direct (37).
 */
import { DEFAULT_ROOM_CLOCK, DEFAULT_ROOM_TURN_MS, ROOM_CLOCKS, ROOM_TURN_MS, type CreateRoomRequest, type DiceProof, type RoomFormat, type RoomGame, type RoomView } from '@kwatt/protocol';
import { verifyGame } from '@kwatt/fair-dice';
import { PRESETS, type Preset } from '@kwatt/rules-ludo';

export const DAMES_VARIANTS = ['dames10', 'dames8'] as const;
export const LUDO_VARIANTS = ['ludo_classique', 'ludo_rapide', 'ludo_parchis', 'ludo_pachisi', 'ludo_six'] as const;
export type RoomVariant = (typeof DAMES_VARIANTS)[number] | (typeof LUDO_VARIANTS)[number];

export const gameOfVariant = (variant: string): RoomGame => (variant.startsWith('ludo') ? 'ludo' : 'dames');
export const presetOf = (variant: string): Preset | null => (variant.startsWith('ludo_') ? (variant.slice(5) as Preset) : null);

/** Places possibles à table (2 aux Dames ; selon la variante au Ludo). */
export function seatRange(variant: string): [number, number] {
  const preset = presetOf(variant);
  if (!preset || !PRESETS[preset]) return [2, 2];
  const [min, max] = PRESETS[preset].players;
  return [min, max];
}

/** Choix proposés sur la planche : 2, 3, 4 et 6 joueurs. */
export const SEAT_CHOICES = [2, 3, 4, 6] as const;

export function seatAllowed(variant: string, seats: number): boolean {
  const [min, max] = seatRange(variant);
  return seats >= min && seats <= max;
}

/** Variante amicale (Parchís, Pachisi…) : ni force ni mise. */
export function isFriendlyVariant(variant: string): boolean {
  const preset = presetOf(variant);
  return preset !== null && PRESETS[preset] !== undefined && !PRESETS[preset].ranked;
}

/** Pas de la mise (planche : 0 à 500 par 50). */
export const STAKE_STEP = 50;
export const STAKE_MAX = 500;

export interface RoomDraft {
  game: RoomGame;
  variant: RoomVariant;
  seats: number;
  format: RoomFormat;
  clockIndex: number;
  turnMs: number;
  stake: number;
}

export const DEFAULT_DRAFT: RoomDraft = {
  game: 'dames',
  variant: 'dames10',
  seats: 2,
  format: 'simple',
  clockIndex: ROOM_CLOCKS.indexOf(DEFAULT_ROOM_CLOCK),
  turnMs: DEFAULT_ROOM_TURN_MS,
  stake: 0,
};

/** Changer de jeu : variante classique, places ramenées dans la plage. */
export function withGame(d: RoomDraft, game: RoomGame): RoomDraft {
  if (game === d.game) return d;
  const variant: RoomVariant = game === 'dames' ? 'dames10' : 'ludo_classique';
  return { ...d, game, variant, seats: game === 'dames' ? 2 : 4 };
}

export function withVariant(d: RoomDraft, variant: RoomVariant): RoomDraft {
  const [min, max] = seatRange(variant);
  const seats = Math.min(max, Math.max(min, d.seats));
  return { ...d, variant, seats, stake: isFriendlyVariant(variant) ? 0 : d.stake };
}

export function draftRequest(d: RoomDraft, name: string): CreateRoomRequest {
  return {
    game: d.game,
    variant: d.variant,
    name: name.trim(),
    seats: d.seats,
    format: d.format,
    stake: isFriendlyVariant(d.variant) ? 0 : d.stake,
    ...(d.game === 'dames' ? { clock: ROOM_CLOCKS[d.clockIndex] ?? DEFAULT_ROOM_CLOCK } : { turnMs: d.turnMs }),
  };
}

export { ROOM_CLOCKS, ROOM_TURN_MS };

/** « 5 min + 3 s » : minutes et secondes d'une pendule. */
export function clockParts(c: { initialMs: number; incrementMs: number }): { minutes: number; seconds: number } {
  return { minutes: Math.round(c.initialMs / 60_000), seconds: Math.round(c.incrementMs / 1000) };
}

/** Le joueur peut-il lancer ? (hôte, assez de joueurs, tous prêts). */
export function startState(room: RoomView): { canStart: boolean; reason: 'not_host' | 'players' | 'ready' | 'playing' | null; missing: number } {
  if (room.status === 'playing') return { canStart: false, reason: 'playing', missing: 0 };
  if (!room.me.isHost) return { canStart: false, reason: 'not_host', missing: 0 };
  const seated = room.table.filter((s) => s.player).length;
  const min = room.game === 'dames' || room.variant === 'ludo_pachisi' ? room.seats : 2;
  if (seated < min) return { canStart: false, reason: 'players', missing: min - seated };
  if (room.table.some((s) => s.player && !s.ready)) return { canStart: false, reason: 'ready', missing: 0 };
  return { canStart: true, reason: null, missing: 0 };
}

/** Route de la partie d'un salon (écran de partie Dames ou Ludo). */
export function gameHref(game: RoomGame, gameId: string, spectate = false): string {
  const base = game === 'dames' ? `/dames/partie/${gameId}` : `/ludo/partie/${gameId}`;
  return spectate ? `${base}?spectate=1` : base;
}

/** Mise d'un défi : bornée par le plafond, au pas de 10 (petits soldes) ou 50. */
export function stakeStep(cap: number): number {
  return cap >= 200 ? 50 : 10;
}

export function clampStake(value: number, cap: number): number {
  return Math.max(0, Math.min(cap, Math.round(value)));
}

/** Les 6 de chacun (écran 22) : nombre de 6 (ou de lancers à 6 cauris ouverts) par siège. */
export interface SeatDiceStats {
  seat: number;
  rolls: number;
  sixes: number;
}

export function diceStats(proof: Pick<DiceProof, 'rolls' | 'kind'>): SeatDiceStats[] {
  const bySeat = new Map<number, SeatDiceStats>();
  for (const r of proof.rolls) {
    const s = bySeat.get(r.seat) ?? { seat: r.seat, rolls: 0, sixes: 0 };
    s.rolls += 1;
    if (r.value === 6) s.sixes += 1;
    bySeat.set(r.seat, s);
  }
  return [...bySeat.values()].sort((a, b) => a.seat - b.seat);
}

/** Part attendue au hasard : 1 sur 6 au dé ; 6 cauris ouverts : 1 sur 64. */
export function expectedSixes(kind: DiceProof['kind'], rolls: number): number {
  return kind === 'die' ? Math.round(rolls / 6) : Math.round(rolls / 64);
}

/** Pourcentages des pronostics par siège (arrondis, somme 100 quand il y en a). */
export function predictionShares(pools: readonly { seat: number; total: number }[]): Map<number, number> {
  const sum = pools.reduce((a, p) => a + p.total, 0);
  const out = new Map<number, number>();
  if (sum === 0) {
    for (const p of pools) out.set(p.seat, Math.round(100 / Math.max(1, pools.length)));
    return out;
  }
  let given = 0;
  pools.forEach((p, i) => {
    const v = i === pools.length - 1 ? 100 - given : Math.round((p.total * 100) / sum);
    given += v;
    out.set(p.seat, v);
  });
  return out;
}

export type ProofVerdict = { state: 'pending' } | { state: 'ok'; count: number } | { state: 'bad'; count: number; mismatches: number[]; commitment: boolean };

/** Recalcule la preuve (tant que la clé n'est pas révélée : partie en cours). */
export function checkProof(proof: DiceProof): ProofVerdict {
  if (!proof.serverSeed) return { state: 'pending' };
  const res = verifyGame({
    gameId: proof.gameId,
    commitment: proof.commitment,
    serverSeed: proof.serverSeed,
    kind: proof.kind,
    rolls: proof.rolls.map((r) => ({ rollIndex: r.rollIndex, clientSeed: r.clientSeed, value: r.value, ...(r.pattern ? { pattern: r.pattern } : {}) })),
  });
  return res.ok ? { state: 'ok', count: proof.rolls.length } : { state: 'bad', count: proof.rolls.length, mismatches: res.mismatches, commitment: res.commitmentMatches };
}
