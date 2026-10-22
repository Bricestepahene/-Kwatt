import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { snap } from './logic';

/**
 * Curseur simple (volume des effets, mise) : piste de 6 px, poignée or de 24 px,
 * zone tactile de 48 px ; réglable aussi au lecteur d'écran (augmenter / diminuer).
 */
export function Slider({
  value,
  onChange,
  onChangeEnd,
  min = 0,
  max = 1,
  step = 0.05,
  accessibilityLabel,
  formatValue,
  disabled,
  style,
}: {
  value: number;
  onChange: (value: number) => void;
  onChangeEnd?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  accessibilityLabel: string;
  /** Texte lu par le lecteur d'écran (« 70 % », « 100 cauris »). */
  formatValue?: (value: number) => string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const latest = useRef({ onChange, onChangeEnd, min, max, step, value });
  latest.current = { onChange, onChangeEnd, min, max, step, value };

  const valueAt = (x: number) => {
    const { min: lo, max: hi, step: st } = latest.current;
    const w = widthRef.current || 1;
    return snap(lo + (x / w) * (hi - lo), lo, hi, st);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => latest.current.onChange(valueAt(event.nativeEvent.locationX)),
      onPanResponderMove: (event) => latest.current.onChange(valueAt(event.nativeEvent.locationX)),
      onPanResponderRelease: (event) => latest.current.onChangeEnd?.(valueAt(event.nativeEvent.locationX)),
    }),
  ).current;

  const ratio = max > min ? (Math.min(max, Math.max(min, value)) - min) / (max - min) : 0;
  const text = formatValue ? formatValue(value) : t('a11y.progress', { value: Math.round(ratio * 100) });
  const nudge = (direction: 1 | -1) => {
    const next = snap(value + direction * step, min, max, step);
    onChange(next);
    onChangeEnd?.(next);
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value, text }}
      accessibilityState={{ disabled: Boolean(disabled) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') nudge(1);
        if (event.nativeEvent.actionName === 'decrement') nudge(-1);
      }}
      style={[styles.hit, disabled ? { opacity: 0.45 } : null, style]}
      onLayout={(e: LayoutChangeEvent) => {
        widthRef.current = e.nativeEvent.layout.width;
        setWidth(e.nativeEvent.layout.width);
      }}
      pointerEvents={disabled ? 'none' : 'auto'}
      {...responder.panHandlers}
    >
      <View pointerEvents="none" style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={{ width: `${ratio * 100}%`, height: '100%', backgroundColor: colors.action }} />
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.thumb,
          { backgroundColor: colors.action, borderColor: colors.bg, left: Math.max(0, ratio * width - 12) },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: 48, justifyContent: 'center', minWidth: 120 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  thumb: { position: 'absolute', width: 24, height: 24, borderRadius: 12, borderWidth: 2, top: 12 },
});
