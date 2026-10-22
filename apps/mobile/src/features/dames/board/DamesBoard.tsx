/**
 * Damier réutilisable (contrat C5), en react-native-svg (D-01), couleurs de @kwatt/design
 * (damier de nuit ou de Plein soleil selon le thème), cases d'au moins 34 px.
 *
 *   <DamesBoard state={state} selected={28} targets={[22, 23]} lastMove={move}
 *               onSquarePress={(sq) => …} flipped={false} showNumbers size={358} interactive />
 *
 * Dessin : cadre en bois (tissu obom), cases claires et foncées, pions ronds avec un anneau
 * et une ombre, dame couronnée d'or. Repères : pion choisi (contour or), cases d'arrivée
 * (point or et liseré), pièces qui seraient prises (pointillés corail), pions qui doivent
 * prendre (anneau or pointillé), dernier coup (cases teintées).
 * Toucher : une zone par case foncée, annoncée aux lecteurs d'écran (« case 28, pion blanc »).
 */
import { brand, checkers } from '@kwatt/design';
import type { DamesState, Move } from '@kwatt/rules-dames';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../../../theme';
import { Fabric } from '../../../ui';
import { cellOf, describePiece, framePadding, geometryOf } from './geometry';

export interface DamesBoardProps {
  state: Pick<DamesState, 'variant' | 'board'>;
  /** Case du pion choisi. */
  selected?: number | null;
  /** Cases où le pion choisi peut aller (ou cases de passage à départager). */
  targets?: readonly number[];
  lastMove?: Pick<Move, 'from' | 'to' | 'path' | 'captures'> | null;
  /** Pièces que le coup choisi prendrait (pointillés corail). */
  threatened?: readonly number[];
  /** Pions qui doivent prendre (prise obligatoire signalée). */
  mustCapture?: readonly number[];
  /** Pièces estompées (rafle en cours, pièces prises au revoir). */
  dimmed?: readonly number[];
  /** Case mise en avant (indice du problème du jour). */
  hint?: number | null;
  onSquarePress?: (square: number) => void;
  /** Noirs en bas (on joue les noirs). */
  flipped?: boolean;
  showNumbers?: boolean;
  /** Côté du damier, cadre compris (px). */
  size: number;
  interactive?: boolean;
  /** Description du damier quand il n'est pas interactif (image). */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const CROWN = 'M2 10 L3 4 L5.5 7 L7 3 L8.5 7 L11 4 L12 10 Z';

function DamesBoardImpl({
  state,
  selected = null,
  targets = [],
  lastMove = null,
  threatened = [],
  mustCapture = [],
  dimmed = [],
  hint = null,
  onSquarePress,
  flipped = false,
  showNumbers = false,
  size,
  interactive = true,
  accessibilityLabel,
  style,
  testID,
}: DamesBoardProps) {
  const { colors, isSun } = useTheme();
  const { t } = useTranslation('dames');
  const g = geometryOf(state.variant);
  const pad = framePadding(size);
  const cell = Math.floor((size - 2 * pad) / g.size);
  const inner = cell * g.size;
  const outer = inner + 2 * pad;
  const blackRing = isSun ? checkers.black.ringSun : checkers.black.ringNight;

  const targetSet = useMemo(() => new Set(targets), [targets]);
  const threatSet = useMemo(() => new Set(threatened), [threatened]);
  const mustSet = useMemo(() => new Set(mustCapture), [mustCapture]);
  const dimSet = useMemo(() => new Set(dimmed), [dimmed]);
  const lastSet = useMemo(() => new Set(lastMove ? [lastMove.from, lastMove.to] : []), [lastMove]);

  const squares = Array.from({ length: g.squares }, (_, i) => i + 1);
  const pieceR = cell * 0.4;
  const ringW = Math.max(3, Math.round(cell * 0.085));
  const shadow = Math.max(2, Math.round(cell * 0.055));

  const label = (sq: number): string => {
    const piece = describePiece(state.board[sq - 1]);
    const base = piece === 'empty' ? t('board.squareEmpty', { n: sq }) : t('board.square', { n: sq, piece: t(`board.piece.${piece}`) });
    if (targetSet.has(sq)) return `${base}, ${t('board.target')}`;
    return base;
  };

  return (
    <Fabric
      name="obom"
      testID={testID}
      style={[{ width: outer, height: outer, padding: pad, borderRadius: size >= 600 ? 16 : 10 }, style]}
      {...(!interactive ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: accessibilityLabel ?? t('board.label') } : {})}
    >
      <View style={{ width: inner, height: inner }}>
        <Svg width={inner} height={inner} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {/* Cases */}
          {Array.from({ length: g.size }, (_, row) =>
            Array.from({ length: g.size }, (_, col) => (
              <Rect
                key={`${row}-${col}`}
                x={col * cell}
                y={row * cell}
                width={cell}
                height={cell}
                fill={(row + col) % 2 === 1 ? colors.board.dark : colors.board.light}
              />
            )),
          )}
          {squares.map((sq) => {
            const { row, col } = cellOf(state.variant, sq, flipped);
            const x = col * cell;
            const y = row * cell;
            const cx = x + cell / 2;
            const cy = y + cell / 2;
            const piece = state.board[sq - 1] ?? '';
            const white = piece === 'w' || piece === 'W';
            const king = piece === 'W' || piece === 'B';
            const faded = dimSet.has(sq);
            return (
              <G key={sq}>
                {lastSet.has(sq) ? <Rect x={x} y={y} width={cell} height={cell} fill={colors.action} opacity={0.28} /> : null}
                {targetSet.has(sq) ? (
                  <Rect x={x + 1.5} y={y + 1.5} width={cell - 3} height={cell - 3} fill="none" stroke={colors.action} strokeWidth={3} />
                ) : null}
                {hint === sq ? (
                  <Rect x={x + 1.5} y={y + 1.5} width={cell - 3} height={cell - 3} fill="none" stroke={colors.action} strokeWidth={3} strokeDasharray="5 4" />
                ) : null}
                {showNumbers ? (
                  <SvgText x={x + 2} y={y + Math.max(9, cell * 0.26)} fontSize={Math.max(8, Math.round(cell * 0.24))} fontWeight="700" fill={brand.raphia} opacity={0.85}>
                    {String(sq)}
                  </SvgText>
                ) : null}
                {piece !== '' ? (
                  <G opacity={faded ? 0.35 : 1}>
                    <Circle cx={cx} cy={cy + shadow} r={pieceR} fill={white ? checkers.white.ring : checkers.black.ringSun} opacity={white ? 0.9 : 1} />
                    <Circle
                      cx={cx}
                      cy={cy}
                      r={pieceR - ringW / 2}
                      fill={white ? checkers.white.fill : checkers.black.fill}
                      stroke={white ? checkers.white.ring : blackRing}
                      strokeWidth={ringW}
                    />
                    {king ? (
                      <Path
                        d={CROWN}
                        fill={brand.orToghu}
                        transform={`translate(${cx - pieceR * 0.55} ${cy - pieceR * 0.55}) scale(${(pieceR * 1.1) / 14})`}
                      />
                    ) : null}
                    {selected === sq ? (
                      <Circle cx={cx} cy={cy} r={pieceR + 3} fill="none" stroke={colors.action} strokeWidth={3} />
                    ) : mustSet.has(sq) ? (
                      <Circle cx={cx} cy={cy} r={pieceR + 2.5} fill="none" stroke={colors.action} strokeWidth={2} strokeDasharray="4 3" />
                    ) : null}
                    {threatSet.has(sq) ? (
                      <Circle cx={cx} cy={cy} r={pieceR + 2.5} fill="none" stroke={colors.alert} strokeWidth={2} strokeDasharray="4 3" />
                    ) : null}
                  </G>
                ) : null}
                {targetSet.has(sq) && piece === '' ? (
                  <G>
                    <Circle cx={cx} cy={cy} r={cell * 0.19 + 4} fill={colors.action} opacity={0.35} />
                    <Circle cx={cx} cy={cy} r={cell * 0.19} fill={colors.action} />
                  </G>
                ) : null}
              </G>
            );
          })}
        </Svg>
        {interactive && onSquarePress ? (
          <View style={StyleSheet.absoluteFill}>
            {squares.map((sq) => {
              const { row, col } = cellOf(state.variant, sq, flipped);
              return (
                <Pressable
                  key={sq}
                  onPress={() => onSquarePress(sq)}
                  accessibilityRole="button"
                  accessibilityLabel={label(sq)}
                  accessibilityState={{ selected: selected === sq }}
                  style={{ position: 'absolute', left: col * cell, top: row * cell, width: cell, height: cell }}
                />
              );
            })}
          </View>
        ) : null}
      </View>
    </Fabric>
  );
}

export const DamesBoard = memo(DamesBoardImpl);
