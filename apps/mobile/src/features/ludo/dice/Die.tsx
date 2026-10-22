/**
 * Dé du Ludo (planches 21 et 21b) : raphia, pastilles rouges, ombre portée. Animation selon
 * la préférence « Animation du dé » (normale, rapide, aucune) et la réduction des animations
 * du système : les faces défilent puis le dé se pose sur la valeur.
 */
import { ludoBoard } from '@kwatt/design';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { DiceAnimation } from '@/preferences';

/** Pastilles d'une face (grille 3 × 3, coordonnées 0 … 2). */
export const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
};

/** Durée de l'animation (ms) selon la préférence. */
export function rollDuration(animation: DiceAnimation, reduceMotion: boolean): number {
  if (reduceMotion || animation === 'none') return 0;
  return animation === 'fast' ? 280 : 650;
}

function Face({ value, size }: { value: number; size: number }) {
  const pips = PIPS[value] ?? [];
  const pad = size * 0.24;
  const step = (size - 2 * pad) / 2;
  return (
    <Svg width={size} height={size}>
      {pips.map(([col, row], i) => (
        <Circle key={i} cx={pad + col * step} cy={pad + row * step} r={size * 0.08} fill={ludoBoard.pip} />
      ))}
    </Svg>
  );
}

export interface DieProps {
  /** Valeur affichée (null : dé blanc en attente). */
  value: number | null;
  /** Compteur de lancers : chaque changement relance l'animation. */
  rollId: number;
  animation: DiceAnimation;
  reduceMotion: boolean;
  size?: number;
  accessibilityLabel: string;
}

export function Die({ value, rollId, animation, reduceMotion, size = 72, accessibilityLabel }: DieProps) {
  const [shown, setShown] = useState<number | null>(value);
  const spin = useRef(new Animated.Value(0)).current;
  const first = useRef(true);

  useEffect(() => {
    const duration = rollDuration(animation, reduceMotion);
    if (first.current || duration === 0 || value === null) {
      first.current = false;
      setShown(value);
      return;
    }
    let face = 1;
    const timer = setInterval(() => {
      face = (face % 6) + 1;
      setShown(face);
    }, 70);
    spin.setValue(0);
    Animated.timing(spin, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const done = setTimeout(() => {
      clearInterval(timer);
      setShown(value);
    }, duration);
    return () => {
      clearInterval(timer);
      clearTimeout(done);
    };
  }, [rollId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Valeur changée sans nouveau lancer (reprise, partie distante) : on l'affiche.
    setShown(value);
  }, [value]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.die,
        { width: size, height: size, borderRadius: size * 0.22, backgroundColor: ludoBoard.die, shadowColor: ludoBoard.dieShadow, transform: [{ rotate }] },
      ]}
    >
      <View style={[StyleSheet.absoluteFill, styles.shadow, { borderRadius: size * 0.22, borderBottomColor: ludoBoard.dieShadow }]} />
      {shown !== null ? <Face value={shown} size={size} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  die: { alignItems: 'center', justifyContent: 'center' },
  shadow: { borderBottomWidth: 4 },
});
