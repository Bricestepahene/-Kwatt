/**
 * Géométrie des plateaux : où dessiner chaque case, chaque couloir, chaque
 * maison. L'appli dessine les plateaux à partir d'ici, sans réinventer les
 * parcours : la case absolue n de `track` est la case n des règles, et
 * `paths[maison][progression]` est la case où se trouve un pion.
 *
 * Unités : la case. Le plateau est un carré `size × size` ; (0, 0) est en haut
 * à gauche, x vers la droite, y vers le bas. Chaque case donne son centre et
 * l'angle de sa branche (en degrés, sens horaire) : 0, 90, 180, 270 sur les
 * croix, des multiples de 60 sur l'étoile (cases tournées).
 *
 * Construction : chaque branche est décrite une seule fois, pointée vers le
 * haut (colonnes 0, 1, 2 de gauche à droite en regardant vers l'extérieur,
 * rangée 0 au bout de la branche), puis tournée autour du centre.
 * - Croix 15 × 15 (planche 21) : maison 0 (rouge) à gauche, puis sens horaire ;
 *   les pions tournent dans le sens horaire.
 * - Étoile (planche 21b) : maison 0 en haut, branches tous les 60°, sens horaire.
 * - Parchís et Pachisi, croix 19 × 19 (branches de 3 × 8, centre 3 × 3) :
 *   maison 0 en bas, puis sens anti-horaire, comme on y joue traditionnellement.
 */
import { TOPOLOGY, type BoardShape, type ProtectionRule } from './variants.js';

export interface Point {
  x: number;
  y: number;
}

export interface Cell extends Point {
  /** Angle de la branche qui porte la case (degrés, sens horaire, 0 = branche vers le haut). */
  angle: number;
}

export type HomeArea = { kind: 'rect'; x: number; y: number; w: number; h: number } | { kind: 'circle'; cx: number; cy: number; r: number };

export interface BoardGeometry {
  board: BoardShape;
  /** Côté du plateau, en cases. */
  size: number;
  center: Point;
  homes: number;
  /** Case absolue n → position. */
  track: Cell[];
  /** paths[maison][progression] : position de la case, de la progression 0 à l'arrivée incluse. */
  paths: Cell[][];
  /** Couloir final de chaque maison (cases privées entre la piste et l'arrivée). */
  corridors: Cell[][];
  /** Pachisi : descente privée de la colonne du milieu avant la piste ; vide ailleurs. */
  lanes: Cell[][];
  /** Point d'arrivée de chaque maison (dans le centre, du côté de sa branche). */
  goals: Point[];
  /** Zone de la maison à colorier (base des pions). */
  homeAreas: HomeArea[];
  /** Emplacements des pions à la base (4 par maison ; le Rapide n'en utilise que 2). */
  baseSlots: Point[][];
  /** Branche de chaque maison : son angle. */
  armAngles: number[];
  /** Case absolue de départ (première case de piste) de chaque maison. */
  starts: number[];
  /** Dernière case de piste de chaque maison, avant son couloir. */
  entries: number[];
  /** Étoiles (croix, étoile). */
  stars: number[];
  /** Châteaux (Pachisi). */
  castles: number[];
  /** Cases protégées selon le réglage de protection (ceux permis sur ce plateau). */
  safe: Partial<Record<ProtectionRule, number[]>>;
}

/** Une case d'une branche décrite pointée vers le haut. */
interface ArmCell {
  arm: number;
  row: number;
  col: number;
}

interface Layout {
  size: number;
  /** Angle de la branche k. */
  angle: (k: number) => number;
  /** Centre d'une case de la branche pointée vers le haut, avant rotation. */
  local: (row: number, col: number) => Point;
  /** Bloc de piste qui part de la case absolue k × block. */
  block: (k: number) => ArmCell[];
  /** Couloir final de la maison k. */
  corridor: (k: number) => ArmCell[];
  /** Descente privée (Pachisi). */
  lane: (k: number) => ArmCell[];
  goal: Point;
  area: HomeArea;
  slots: Point[];
}

function rotate(p: Point, c: Point, deg: number): Point {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const x = c.x + (p.x - c.x) * cos - (p.y - c.y) * sin;
  const y = c.y + (p.x - c.x) * sin + (p.y - c.y) * cos;
  // Arrondi : les rotations d'un quart de tour tombent juste.
  // `|| 0` : jamais de « −0 » dans les coordonnées.
  return { x: Math.round(x * 1e6) / 1e6 || 0, y: Math.round(y * 1e6) / 1e6 || 0 };
}

const range = (from: number, to: number): number[] => {
  const out: number[] = [];
  if (from <= to) for (let i = from; i <= to; i++) out.push(i);
  else for (let i = from; i >= to; i--) out.push(i);
  return out;
};

/** Croix 15 × 15 et étoile : branches de 3 × 6, blocs de 13 cases. */
function ludoBlock(homes: number): (k: number) => ArmCell[] {
  return (k) => {
    const next = (k + 1) % homes;
    return [
      ...range(1, 5).map((row) => ({ arm: k, row, col: 2 })),
      ...range(5, 0).map((row) => ({ arm: next, row, col: 0 })),
      { arm: next, row: 0, col: 1 },
      { arm: next, row: 0, col: 2 },
    ];
  };
}

/** Parchís et Pachisi : branches de 3 × 8, blocs de 17 cases depuis le bout de la branche. */
function block17(k: number): ArmCell[] {
  const next = (k + 1) % 4;
  return [
    { arm: k, row: 0, col: 1 },
    ...range(0, 7).map((row) => ({ arm: k, row, col: 0 })),
    ...range(7, 0).map((row) => ({ arm: next, row, col: 2 })),
  ];
}

const LAYOUTS: Record<BoardShape, Layout> = {
  croix: {
    size: 15,
    angle: (k) => (270 + 90 * k) % 360,
    local: (row, col) => ({ x: 6 + col + 0.5, y: row + 0.5 }),
    block: ludoBlock(4),
    corridor: (k) => range(1, 5).map((row) => ({ arm: k, row, col: 1 })),
    lane: () => [],
    goal: { x: 7.5, y: 6.3 },
    area: { kind: 'rect', x: 9, y: 0, w: 6, h: 6 },
    slots: [
      { x: 11, y: 2 },
      { x: 13, y: 2 },
      { x: 11, y: 4 },
      { x: 13, y: 4 },
    ],
  },
  etoile: {
    size: 18,
    angle: (k) => 60 * k,
    // Bord intérieur des branches à 2,6 cases du centre (planche 21b : branches de 3 × 6 autour d'un hexagone).
    local: (row, col) => ({ x: 8 + col, y: 9 - (2.6 + 5.5 - row) }),
    block: ludoBlock(6),
    corridor: (k) => range(1, 5).map((row) => ({ arm: k, row, col: 1 })),
    lane: () => [],
    goal: { x: 9, y: 7.8 },
    area: { kind: 'circle', cx: 9 + 7 * Math.sin(Math.PI / 6), cy: 9 - 7 * Math.cos(Math.PI / 6), r: 1.5 },
    slots: [-1, 1].flatMap((dy) => [-1, 1].map((dx) => ({ x: 9 + 7 * Math.sin(Math.PI / 6) + 0.7 * dx, y: 9 - 7 * Math.cos(Math.PI / 6) + 0.7 * dy }))),
  },
  parchis: {
    size: 19,
    angle: (k) => (180 - 90 * k + 360) % 360,
    local: (row, col) => ({ x: 8 + col + 0.5, y: row + 0.5 }),
    block: block17,
    corridor: (k) => range(1, 7).map((row) => ({ arm: k, row, col: 1 })),
    lane: () => [],
    goal: { x: 9.5, y: 8.3 },
    // Maison à gauche de sa branche (en regardant vers l'extérieur), à côté de sa case de sortie.
    area: { kind: 'rect', x: 0, y: 0, w: 8, h: 8 },
    slots: [
      { x: 3, y: 3 },
      { x: 5, y: 3 },
      { x: 3, y: 5 },
      { x: 5, y: 5 },
    ],
  },
  pachisi: {
    size: 19,
    angle: (k) => (180 - 90 * k + 360) % 360,
    local: (row, col) => ({ x: 8 + col + 0.5, y: row + 0.5 }),
    // Le bloc part du bout de la branche (progression 7) ; la piste du Pachisi commence là.
    block: block17,
    corridor: (k) => range(1, 7).map((row) => ({ arm: k, row, col: 1 })),
    lane: (k) => range(7, 1).map((row) => ({ arm: k, row, col: 1 })),
    goal: { x: 9.5, y: 8.3 },
    area: { kind: 'rect', x: 0, y: 0, w: 8, h: 8 },
    slots: [
      { x: 3, y: 3 },
      { x: 5, y: 3 },
      { x: 3, y: 5 },
      { x: 5, y: 5 },
    ],
  },
};

const cache = new Map<BoardShape, BoardGeometry>();

/** Géométrie complète d'un plateau (calculée une fois). */
export function boardGeometry(board: BoardShape): BoardGeometry {
  const hit = cache.get(board);
  if (hit) return hit;
  const t = TOPOLOGY[board];
  const L = LAYOUTS[board];
  const center: Point = { x: L.size / 2, y: L.size / 2 };
  const place = (c: ArmCell): Cell => ({ ...rotate(L.local(c.row, c.col), center, L.angle(c.arm)), angle: L.angle(c.arm) });
  const point = (p: Point, k: number): Point => rotate(p, center, L.angle(k));

  // Piste : le bloc k commence à la case absolue k × block (croix, étoile : départ de la maison k ;
  // Parchís, Pachisi : bout de la branche k, entrée de son couloir).
  const track: Cell[] = new Array<Cell>(t.trackLength);
  for (let k = 0; k < t.homes; k++) {
    L.block(k).forEach((c, rel) => {
      track[(k * t.block + rel) % t.trackLength] = place(c);
    });
  }
  const homes = range(0, t.homes - 1);
  const corridors = homes.map((k) => L.corridor(k).map(place));
  const lanes = homes.map((k) => L.lane(k).map(place));
  const goals = homes.map((k) => point(L.goal, k));
  const armAngles = homes.map((k) => L.angle(k));
  const starts = homes.map((k) => (t.startOffset + k * t.block) % t.trackLength);
  const entries = homes.map((k) => (t.startOffset + k * t.block + t.lastTrack - t.trackStart) % t.trackLength);
  const paths = homes.map((k) => {
    const out: Cell[] = [];
    for (let p = 0; p <= t.finish; p++) {
      if (p < t.trackStart) out.push(lanes[k]![p]!);
      else if (p <= t.lastTrack) out.push(track[(t.startOffset + k * t.block + p - t.trackStart) % t.trackLength]!);
      else if (p < t.finish) out.push(corridors[k]![p - t.lastTrack - 1]!);
      else out.push({ ...goals[k]!, angle: armAngles[k]! });
    }
    return out;
  });
  const homeAreas = homes.map((k): HomeArea => {
    if (L.area.kind === 'circle') {
      const c = point({ x: L.area.cx, y: L.area.cy }, k);
      return { kind: 'circle', cx: c.x, cy: c.y, r: L.area.r };
    }
    const a = point({ x: L.area.x, y: L.area.y }, k);
    const b = point({ x: L.area.x + L.area.w, y: L.area.y + L.area.h }, k);
    return { kind: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  });
  const baseSlots = homes.map((k) => L.slots.map((s) => point(s, k)));
  const marks = (offsets: number[]): number[] =>
    homes.flatMap((k) => offsets.map((o) => (t.startOffset + k * t.block + o) % t.trackLength)).sort((a, b) => a - b);
  const safe: Partial<Record<ProtectionRule, number[]>> = {};
  for (const [rule, offsets] of Object.entries(t.protection) as [ProtectionRule, number[]][]) safe[rule] = marks(offsets);

  const g: BoardGeometry = {
    board,
    size: L.size,
    center,
    homes: t.homes,
    track,
    paths,
    corridors,
    lanes,
    goals,
    homeAreas,
    baseSlots,
    armAngles,
    starts,
    entries,
    stars: marks(t.stars),
    castles: marks(t.castles),
    safe,
  };
  cache.set(board, g);
  return g;
}

/** Position d'un pion : son emplacement à la base (progression BASE = −1) ou sa case. */
export function tokenPoint(geometry: BoardGeometry, home: number, progress: number, token: number): Point {
  if (progress < 0) {
    const slots = geometry.baseSlots[home]!;
    return slots[token % slots.length]!;
  }
  return geometry.paths[home]![Math.min(progress, geometry.paths[home]!.length - 1)]!;
}
