/**
 * Plateau du Ludo (contrat C5) : croix 15 × 15 (planche 21), étoile à 6 branches (21b),
 * croix du Parchís et du Pachisi (19 × 19), dessinés en react-native-svg depuis la géométrie
 * exportée par @kwatt/rules-ludo — jamais de parcours réinventé ici.
 *
 *   <LudoBoard state={state} geometry={boardGeometry(state.config.board)} highlighted={moves}
 *              onTokenPress={(seat, token) => …} size={360} />
 *
 * Pions de couleur doublés d'une forme ; les pions jouables ont un anneau sombre et une zone
 * tactile d'au moins 48 px (vue posée par-dessus le dessin, annoncée au lecteur d'écran).
 */
import { ludoBoard } from '@kwatt/design';
import { BASE, finish, type BoardGeometry, type LudoState } from '@kwatt/rules-ludo';
import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Polygon, Rect } from 'react-native-svg';
import { baseRadius, cellViews, centerTriangles, hitRadius, tokenViews, type CellView, type TokenView } from './layout';
import { seatStyle, Shape, TokenShape } from './TokenShape';

export interface LudoBoardProps {
  state: LudoState;
  geometry: BoardGeometry;
  /** Pions jouables (mis en évidence et touchables). */
  highlighted?: readonly { seat: number; token: number }[];
  onTokenPress?: (seat: number, token: number) => void;
  /** Côté du plateau en px. */
  size: number;
  /** Étiquette d'un pion jouable pour le lecteur d'écran. */
  tokenLabel?: (token: TokenView) => string;
  accessibilityLabel?: string;
}

function starPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(3)},${(cy + rr * Math.sin(a)).toFixed(3)}`);
  }
  return pts.join(' ');
}

function Cell({ c }: { c: CellView }) {
  const fill = c.home === null ? ludoBoard.cell : seatStyle(c.home).color;
  return (
    <G transform={`rotate(${c.angle} ${c.x} ${c.y})`}>
      <Rect x={c.x - 0.5} y={c.y - 0.5} width={1} height={1} fill={fill} stroke={ludoBoard.line} strokeWidth={0.04} />
      {c.mark === 'star' ? <Polygon points={starPoints(c.x, c.y, 0.36)} fill={ludoBoard.star} /> : null}
      {c.mark === 'safe' ? <Circle cx={c.x} cy={c.y} r={0.3} fill="none" stroke={ludoBoard.star} strokeWidth={0.07} /> : null}
      {c.mark === 'castle' ? (
        <G stroke={ludoBoard.star} strokeWidth={0.08} strokeLinecap="round">
          <Line x1={c.x - 0.32} y1={c.y - 0.32} x2={c.x + 0.32} y2={c.y + 0.32} />
          <Line x1={c.x + 0.32} y1={c.y - 0.32} x2={c.x - 0.32} y2={c.y + 0.32} />
        </G>
      ) : null}
    </G>
  );
}

function BoardDrawing({ geometry: g, config }: { geometry: BoardGeometry; config: LudoState['config'] }) {
  const cells = useMemo(() => cellViews(config, g), [config, g]);
  const triangles = useMemo(() => centerTriangles(g), [g]);
  const star = g.board === 'etoile';
  return (
    <G>
      {star ? (
        <Circle cx={g.center.x} cy={g.center.y} r={g.size / 2} fill={ludoBoard.starBoard} />
      ) : (
        <Rect x={0} y={0} width={g.size} height={g.size} rx={0.4} fill={ludoBoard.cell} />
      )}
      {g.homeAreas.map((a, home) => {
        const color = seatStyle(home).color;
        if (a.kind === 'circle') return <Circle key={`h${home}`} cx={a.cx} cy={a.cy} r={a.r + 0.3} fill={color} />;
        const inset = a.w > 6 ? 1.5 : 1;
        return (
          <G key={`h${home}`}>
            <Rect x={a.x} y={a.y} width={a.w} height={a.h} fill={color} />
            <Rect x={a.x + inset} y={a.y + inset} width={a.w - 2 * inset} height={a.h - 2 * inset} rx={0.6} fill={ludoBoard.cell} />
          </G>
        );
      })}
      {cells.map((c) => (
        <Cell key={c.key} c={c} />
      ))}
      {triangles.map((t) => (
        <Polygon key={`tri${t.home}`} points={t.points.map((p) => `${p.x},${p.y}`).join(' ')} fill={seatStyle(t.home).color} stroke={ludoBoard.line} strokeWidth={0.03} />
      ))}
    </G>
  );
}

const MemoDrawing = memo(BoardDrawing);

export function LudoBoard({ state, geometry, highlighted = [], onTokenPress, size, tokenLabel, accessibilityLabel }: LudoBoardProps) {
  const cellPx = size / geometry.size;
  const playable = useMemo(() => new Set(highlighted.map((m) => `${m.seat}:${m.token}`)), [highlighted]);
  const tokens = useMemo(() => tokenViews(state, geometry, playable, finish(state.config)), [state, geometry, playable]);
  const hr = hitRadius(cellPx);
  // Emplacements de base occupés (on ne dessine le pointillé que des places vides).
  const occupied = useMemo(() => {
    const set = new Set<string>();
    const slots = geometry.baseSlots[0]?.length ?? 4;
    state.seats.forEach((s, seat) => {
      if (s.status === 'out') return;
      state.tokens[seat]!.forEach((p, token) => {
        if (p === BASE) set.add(`${s.home}:${token % slots}`);
      });
    });
    return set;
  }, [state, geometry]);
  return (
    <View style={{ width: size, height: size }} accessible={!!accessibilityLabel} accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Svg width={size} height={size} viewBox={`0 0 ${geometry.size} ${geometry.size}`}>
        <MemoDrawing geometry={geometry} config={state.config} />
        {geometry.baseSlots.map((slots, home) =>
          slots.slice(0, state.config.mechanics.tokensPerPlayer).map((p, i) =>
            occupied.has(`${home}:${i}`) ? null : (
              <Circle
                key={`s${home}-${i}`}
                cx={p.x}
                cy={p.y}
                r={baseRadius(geometry)}
                fill="none"
                stroke={geometry.homeAreas[home]?.kind === 'circle' ? ludoBoard.cell : seatStyle(home).color}
                strokeWidth={0.08}
                strokeDasharray="0.18 0.12"
              />
            ),
          ),
        )}
        {tokens.map((t) => (
          <TokenShape key={t.key} home={t.home} cx={t.x} cy={t.y} r={t.r} playable={t.playable} />
        ))}
      </Svg>
      {onTokenPress
        ? tokens
            .filter((t) => t.playable)
            .map((t) => (
              <Pressable
                key={`p${t.key}`}
                accessibilityRole="button"
                accessibilityLabel={tokenLabel?.(t)}
                onPress={() => onTokenPress(t.seat, t.token)}
                hitSlop={4}
                style={[
                  styles.hit,
                  { left: (t.x - hr) * cellPx, top: (t.y - hr) * cellPx, width: 2 * hr * cellPx, height: 2 * hr * cellPx, borderRadius: hr * cellPx },
                ]}
              />
            ))
        : null}
    </View>
  );
}

/** Petite forme seule (légende des joueurs, pastilles des bandeaux). */
export function SeatGlyph({ home, size = 12 }: { home: number; size?: number }) {
  const s = seatStyle(home);
  return (
    <Svg width={size} height={size} viewBox="0 0 2 2" accessibilityElementsHidden importantForAccessibility="no">
      <Shape shape={s.shape} cx={1} cy={1} r={0.9} fill={s.color} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  hit: { position: 'absolute' },
});
