/**
 * Géométrie du damier. Les cases jouables sont numérotées comme la notation
 * officielle : 1 à 50 en 10×10, 1 à 32 en 8×8, de gauche à droite et de haut
 * en bas, les noirs en haut. Une case foncée est en (ligne, colonne) avec
 * ligne + colonne impaire, comme sur l'écran 16.
 */

export interface Geometry {
  size: 8 | 10;
  squares: number;
  /** Rangées de pions au départ, pour chaque camp. */
  startRows: number;
}

export const GEOMETRY_10: Geometry = { size: 10, squares: 50, startRows: 4 };
export const GEOMETRY_8: Geometry = { size: 8, squares: 32, startRows: 3 };

export function toSquare(g: Geometry, row: number, col: number): number | null {
  if (row < 0 || col < 0 || row >= g.size || col >= g.size) return null;
  if ((row + col) % 2 === 0) return null;
  return row * (g.size / 2) + Math.floor(col / 2) + 1;
}

export function toCoord(g: Geometry, square: number): { row: number; col: number } {
  const half = g.size / 2;
  const i = square - 1;
  const row = Math.floor(i / half);
  const k = i % half;
  const col = row % 2 === 0 ? 2 * k + 1 : 2 * k;
  return { row, col };
}

/** Les quatre directions diagonales (dRow, dCol). */
export const DIRECTIONS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;

/**
 * Pour chaque case (index 0) et chaque direction, la suite des cases rencontrées.
 * Précalculé une fois par géométrie.
 */
export function buildRays(g: Geometry): number[][][] {
  const rays: number[][][] = [];
  for (let s = 1; s <= g.squares; s++) {
    const { row, col } = toCoord(g, s);
    rays.push(
      DIRECTIONS.map(([dr, dc]) => {
        const ray: number[] = [];
        let r = row + dr;
        let c = col + dc;
        let sq = toSquare(g, r, c);
        while (sq !== null) {
          ray.push(sq);
          r += dr;
          c += dc;
          sq = toSquare(g, r, c);
        }
        return ray;
      }),
    );
  }
  return rays;
}
