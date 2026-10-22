/**
 * Ce qu'on dessine sur un plateau de Ludo, calculé depuis la géométrie de @kwatt/rules-ludo
 * (`boardGeometry`) : cases et leurs marques, centre, maisons, pions (avec les piles).
 * Unité : la case (le composant multiplie par la taille d'une case). Module pur.
 */
import { BASE, isSafeSquare, tokenPoint, type BoardGeometry, type Config, type LudoState, type Point } from '@kwatt/rules-ludo';

export type CellMark = 'star' | 'safe' | 'castle' | null;

export interface CellView {
  key: string;
  x: number;
  y: number;
  angle: number;
  /** Maison dont la case prend la couleur (départ, couloir), sinon null (raphia). */
  home: number | null;
  mark: CellMark;
}

/** Demi-largeur des branches (3 cases) et distance du centre à leur bord intérieur. */
export function centerApothem(geometry: Pick<BoardGeometry, 'board'>): number {
  return geometry.board === 'etoile' ? 2.6 : 1.5;
}

/** Cases du plateau : piste, couloirs, descentes du Pachisi (sans doublon). */
export function cellViews(config: Pick<Config, 'board' | 'mechanics'>, g: BoardGeometry): CellView[] {
  const out: CellView[] = [];
  const seen = new Set<string>();
  const add = (c: { x: number; y: number; angle: number }, home: number | null, mark: CellMark, key: string): void => {
    const k = `${c.x.toFixed(3)},${c.y.toFixed(3)}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ key, x: c.x, y: c.y, angle: c.angle, home, mark });
  };
  const starts = new Map(g.starts.map((sq, home) => [sq, home]));
  g.track.forEach((c, sq) => {
    let mark: CellMark = null;
    if (g.castles.includes(sq)) mark = 'castle';
    else if (g.stars.includes(sq) && isSafeSquare(config, sq)) mark = 'star';
    else if (config.board === 'parchis' && isSafeSquare(config, sq) && !starts.has(sq)) mark = 'safe';
    add(c, starts.get(sq) ?? null, mark, `t${sq}`);
  });
  g.corridors.forEach((list, home) => list.forEach((c, i) => add(c, home, null, `c${home}-${i}`)));
  g.lanes.forEach((list, home) => list.forEach((c, i) => add(c, home, null, `l${home}-${i}`)));
  return out;
}

/** Triangles du centre, un par maison, pointés vers le centre (couleur de la maison). */
export function centerTriangles(g: BoardGeometry): { home: number; points: Point[] }[] {
  const a = centerApothem(g);
  const half = 1.5;
  return g.armAngles.map((deg, home) => {
    const r = (deg * Math.PI) / 180;
    const dir = { x: Math.sin(r), y: -Math.cos(r) };
    const perp = { x: Math.cos(r), y: Math.sin(r) };
    const p1 = { x: g.center.x + a * dir.x + half * perp.x, y: g.center.y + a * dir.y + half * perp.y };
    const p2 = { x: g.center.x + a * dir.x - half * perp.x, y: g.center.y + a * dir.y - half * perp.y };
    return { home, points: [g.center, p1, p2] };
  });
}

export interface TokenView {
  key: string;
  seat: number;
  token: number;
  home: number;
  x: number;
  y: number;
  /** Rayon (en cases). */
  r: number;
  atBase: boolean;
  /** Rentré au centre. */
  arrived: boolean;
  playable: boolean;
}

/** Décalages d'une pile de n pions sur une même case (en cases). */
export function stackOffsets(n: number): Point[] {
  if (n <= 1) return [{ x: 0, y: 0 }];
  if (n === 2) return [{ x: -0.2, y: -0.2 }, { x: 0.2, y: 0.2 }];
  if (n === 3) return [{ x: -0.22, y: -0.18 }, { x: 0.22, y: -0.18 }, { x: 0, y: 0.22 }];
  const out: Point[] = [];
  for (let i = 0; i < n; i++) out.push({ x: (i % 2 === 0 ? -0.22 : 0.22) + 0.05 * Math.floor(i / 4), y: (i % 4 < 2 ? -0.22 : 0.22) });
  return out;
}

/**
 * Pions à dessiner. Plusieurs pions sur la même case se rangent en petite pile (rayon
 * réduit) ; les pions rentrés se rangent autour de l'arrivée de leur maison.
 */
export function tokenViews(state: Pick<LudoState, 'seats' | 'tokens'>, g: BoardGeometry, playable: ReadonlySet<string>, finishProgress: number): TokenView[] {
  const placed: Omit<TokenView, 'x' | 'y' | 'r'>[] = [];
  const points: Point[] = [];
  state.seats.forEach((s, seat) => {
    if (s.status === 'out') return;
    state.tokens[seat]!.forEach((progress, token) => {
      const atBase = progress === BASE;
      placed.push({ key: `${seat}:${token}`, seat, token, home: s.home, atBase, arrived: progress >= finishProgress, playable: playable.has(`${seat}:${token}`) });
      points.push(tokenPoint(g, s.home, progress, token));
    });
  });
  const groups = new Map<string, number[]>();
  points.forEach((p, i) => {
    const k = `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    const list = groups.get(k);
    if (list) list.push(i);
    else groups.set(k, [i]);
  });
  const out: TokenView[] = new Array(placed.length);
  for (const list of groups.values()) {
    const offsets = stackOffsets(list.length);
    list.forEach((i, j) => {
      const base = placed[i]!;
      const p = points[i]!;
      const o = offsets[j] ?? { x: 0, y: 0 };
      const r = base.atBase ? 0.55 : list.length > 1 ? 0.3 : 0.38;
      out[i] = { ...base, x: p.x + o.x, y: p.y + o.y, r };
    });
  }
  // Les pions jouables au-dessus des autres.
  return out.sort((a, b) => Number(a.playable) - Number(b.playable));
}

/** Rayon de la zone tactile d'un pion jouable (en cases) : au moins 48 px de diamètre. */
export function hitRadius(cellPx: number): number {
  return Math.max(0.9, 24 / cellPx);
}
