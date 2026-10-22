/**
 * Les 6 cauris du Pachisi (planche 21c, LancerCauris) : ouverture vers le ciel (fente) ou dos
 * bombé, et le tableau « Ce que valent les cauris » (0 ouverture → 25, 1 → 10, 2 à 6 → 2 à 6).
 */
import { cowrie } from '@kwatt/design';
import { COWRIE_VALUES, isGrace } from '@kwatt/rules-ludo';
import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '@/theme';
import { Text } from '@/ui';

export function Shell({ up, width = 38 }: { up: boolean; width?: number }) {
  const id = `cw${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const h = width * (52 / 38);
  return (
    <Svg width={width} height={h + 3} viewBox="0 0 38 55">
      <Defs>
        <RadialGradient id={id} cx="40%" cy="35%" r="70%">
          <Stop offset="0" stopColor={cowrie.backLight} />
          <Stop offset="1" stopColor={cowrie.backDark} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={19} cy={29} rx={19} ry={26} fill={cowrie.shadow} />
      <Ellipse cx={19} cy={26} rx={19} ry={26} fill={up ? cowrie.up : `url(#${id})`} />
      {up ? (
        <>
          <Rect x={13} y={9} width={3} height={34} rx={1.5} fill={cowrie.slitEdge} />
          <Rect x={22} y={9} width={3} height={34} rx={1.5} fill={cowrie.slitEdge} />
          <Rect x={16} y={9} width={6} height={34} rx={3} fill={cowrie.slit} />
        </>
      ) : (
        <Rect x={10} y={23} width={18} height={6} rx={3} fill={cowrie.backMark} />
      )}
    </Svg>
  );
}

export function CowrieRow({ shells, width = 38, accessibilityLabel }: { shells: readonly boolean[]; width?: number; accessibilityLabel: string }) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={[styles.row, { gap: Math.round(width * 0.27) }]}>
      {shells.map((up, i) => (
        <Shell key={i} up={up} width={width} />
      ))}
    </View>
  );
}

/** Tableau des valeurs, la valeur tirée encadrée d'or, les grâces en vert. */
export function CowrieTable({ up, openingsLabel }: { up: number | null; openingsLabel: (n: number) => string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.table, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {COWRIE_VALUES.map((value, n) => {
        const on = n === up;
        const grace = isGrace(value);
        return (
          <View
            key={n}
            accessible
            accessibilityLabel={`${openingsLabel(n)} : ${value}`}
            style={[styles.cell, on ? { backgroundColor: colors.bg, borderColor: colors.action, borderWidth: 2 } : null]}
          >
            <Text variant="caption" tone={grace ? 'gain' : 'muted'} numberOfLines={1} adjustsFontSizeToFit>
              {openingsLabel(n)}
            </Text>
            <Text variant="number" style={styles.value} tone={grace ? 'gain' : 'default'}>
              {value}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  table: { flexDirection: 'row', gap: 4, borderWidth: 1, borderRadius: 12, padding: 6 },
  cell: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 8, paddingHorizontal: 2, borderRadius: 10, borderWidth: 2, borderColor: 'transparent' },
  value: { fontSize: 14, lineHeight: 18 },
});
