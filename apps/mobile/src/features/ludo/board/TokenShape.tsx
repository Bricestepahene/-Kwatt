/**
 * Pion du Ludo : couleur de la maison doublée d'une forme (audit, point 2 ; @kwatt/design
 * `ludoSeats`) — rond, carré, losange, gélule, hexagone, triangle. En SVG, unité libre.
 */
import { ludoBoard, ludoSeats } from '@kwatt/design';
import { Circle, G, Path, Polygon, Rect } from 'react-native-svg';

export type TokenShapeName = (typeof ludoSeats)[number]['shape'];

export function seatStyle(home: number): (typeof ludoSeats)[number] {
  return ludoSeats[home % ludoSeats.length]!;
}

/** Contour du pion : raphia, ou nuit sur le jaune (contraste). */
export function ringFor(home: number): string {
  return seatStyle(home).id === 'jaune' ? ludoBoard.tokenRingOnLight : ludoBoard.tokenRing;
}

interface ShapeProps {
  shape: TokenShapeName;
  cx: number;
  cy: number;
  r: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}

function polygon(points: [number, number][], cx: number, cy: number, r: number): string {
  return points.map(([x, y]) => `${(cx + x * r).toFixed(3)},${(cy + y * r).toFixed(3)}`).join(' ');
}

/** Une forme seule (sans ombre ni contour de jeu). */
export function Shape({ shape, cx, cy, r, fill, stroke, strokeWidth }: ShapeProps) {
  const common = { fill, ...(stroke ? { stroke, strokeWidth: strokeWidth ?? r * 0.18 } : {}) };
  switch (shape) {
    case 'rond':
      return <Circle cx={cx} cy={cy} r={r} {...common} />;
    case 'carre':
      return <Rect x={cx - r * 0.9} y={cy - r * 0.9} width={r * 1.8} height={r * 1.8} rx={r * 0.22} {...common} />;
    case 'losange':
      return <Polygon points={polygon([[0, -1.05], [1.05, 0], [0, 1.05], [-1.05, 0]], cx, cy, r)} {...common} strokeLinejoin="round" />;
    case 'gelule': {
      // Arrondi en haut, presque droit en bas (planche 21 : border-radius 50 % 50 % 3px 3px).
      const w = r * 0.92;
      const k = r * 0.2;
      const d = `M ${cx - w} ${cy + r - k} L ${cx - w} ${cy} A ${w} ${w} 0 0 1 ${cx + w} ${cy} L ${cx + w} ${cy + r - k} Q ${cx + w} ${cy + r} ${cx + w - k} ${cy + r} L ${cx - w + k} ${cy + r} Q ${cx - w} ${cy + r} ${cx - w} ${cy + r - k} Z`;
      return <Path d={d} {...common} />;
    }
    case 'hexagone':
      return <Polygon points={polygon([[-0.5, -0.92], [0.5, -0.92], [1, 0], [0.5, 0.92], [-0.5, 0.92], [-1, 0]], cx, cy, r)} {...common} strokeLinejoin="round" />;
    case 'triangle':
      return <Polygon points={polygon([[0, -1.05], [1.05, 0.85], [-1.05, 0.85]], cx, cy, r)} {...common} strokeLinejoin="round" />;
  }
}

/** Pion complet : ombre, corps coloré, contour ; anneau sombre s'il est jouable. */
export function TokenShape({ home, cx, cy, r, playable = false }: { home: number; cx: number; cy: number; r: number; playable?: boolean }) {
  const s = seatStyle(home);
  return (
    <G>
      {playable ? <Circle cx={cx} cy={cy} r={r * 1.45} fill="none" stroke={ludoBoard.playable} strokeWidth={r * 0.28} /> : null}
      <Shape shape={s.shape} cx={cx} cy={cy + r * 0.16} r={r} fill={ludoBoard.tokenShadow} />
      <Shape shape={s.shape} cx={cx} cy={cy} r={r} fill={s.color} stroke={ringFor(home)} />
    </G>
  );
}
