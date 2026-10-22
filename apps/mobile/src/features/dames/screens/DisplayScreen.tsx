/**
 * Écran 17 · Mode Plein soleil (planche PleinSoleil) : réglage d'affichage Nuit / Plein
 * soleil / Automatique (src/theme), avec l'aperçu d'une partie : bandeaux, damier, consigne.
 * Le changement est immédiat : l'aperçu se redessine dans le thème choisi.
 */
import { boardFrom, fromPosition, legalMoves } from '@kwatt/rules-dames';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { updatePreferences, usePreferences, type ThemeSetting } from '../../../preferences';
import { COMPACT_FONT_SCALE, textVariants, useTheme } from '../../../theme';
import { Avatar, IconButton, Screen, Text, Toggle, goBack } from '../../../ui';
import { DamesBoard } from '../board/DamesBoard';
import { EMPTY_SELECTION, tap, targetsOf, threatened } from '../board/selection';

/** Position de l'aperçu (planches 16 et 17) : ton pion en 28 doit prendre en 23. */
const SAMPLE = fromPosition(
  'dames10',
  boardFrom('dames10', {
    b: [1, 2, 3, 5, 6, 7, 9, 10, 12, 13, 15, 17, 18, 20, 23],
    w: [28, 31, 32, 33, 34, 36, 38, 40, 41, 42, 43, 45, 46, 47, 49],
  }),
  'w',
);

export function DisplayScreen() {
  const { t } = useTranslation('dames');
  const { t: tc } = useTranslation('common');
  const { colors, isSun } = useTheme();
  const setting = usePreferences((p) => p.theme);
  const numbers = usePreferences((p) => p.boardNumbers);
  const { width } = useWindowDimensions();

  const legal = useMemo(() => legalMoves(SAMPLE), []);
  const sel = useMemo(() => {
    const r = tap(legal, EMPTY_SELECTION, 28);
    return r.kind === 'select' ? r.selection : EMPTY_SELECTION;
  }, [legal]);
  const boardSize = Math.min(width - 10, 480);
  const modeName = isSun ? t('display.sun') : t('display.night');
  const note = setting === 'auto' ? t('display.noteAuto') : isSun ? t('display.noteSun') : t('display.noteNight');
  const options: { value: ThemeSetting; label: string }[] = [
    { value: 'sun', label: t('display.sun') },
    { value: 'night', label: t('display.night') },
    { value: 'auto', label: t('display.auto') },
  ];

  return (
    <Screen padded={false} gap={0} testID="screen-affichage">
      <View style={styles.top}>
        <IconButton icon="back" accessibilityLabel={tc('action.back')} onPress={() => goBack('/parametres')} />
        <Text variant="smallStrong" tone="muted" accessibilityRole="header">
          {t('display.label')}
        </Text>
        <View
          accessibilityRole={Platform.OS === 'web' ? 'tablist' : 'radiogroup'}
          accessibilityLabel={t('display.label')}
          style={[styles.seg, { backgroundColor: colors.surface }]}
        >
          {options.map((o) => {
            const on = o.value === setting;
            return (
              <Pressable
                key={o.value}
                accessibilityRole={Platform.OS === 'web' ? 'tab' : 'radio'}
                accessibilityState={{ selected: on, checked: on }}
                onPress={() => updatePreferences({ theme: o.value })}
                style={({ pressed }) => [styles.segItem, { backgroundColor: on ? colors.text : 'transparent', opacity: pressed && !on ? 0.75 : 1 }]}
              >
                <Text
                  style={[textVariants.badge, styles.segLabel, { color: on ? colors.bg : colors.textMuted }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  maxFontSizeMultiplier={COMPACT_FONT_SCALE}
                >
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.preview}>
        <View style={styles.band}>
          <Avatar name={t('display.sampleOpponent')} size={34} decorative />
          <Text variant="bodyStrong">{t('display.sampleOpponent')}</Text>
          <Text variant="small" tone="muted">
            14
          </Text>
          <View style={styles.flex} />
          <Text variant="number" tone="muted">
            3:48
          </Text>
        </View>
        <View style={styles.center}>
          <DamesBoard
            state={SAMPLE}
            selected={sel.from}
            targets={targetsOf(legal, sel)}
            threatened={threatened(legal, sel)}
            size={boardSize}
            showNumbers={numbers}
            interactive={false}
            accessibilityLabel={t('display.boardLabel', { mode: modeName })}
          />
        </View>
        <Text variant="labelStrong" tone="action" align="center">
          {t('game.mustCapture')}
        </Text>
        <View style={styles.band}>
          <Avatar name="Brice" size={40} ringColor={colors.action} decorative />
          <View>
            <Text variant="bodyStrong">{t('game.yourTurn')}</Text>
            <Text variant="small" tone="muted">
              {t('game.men', { count: 15 })}
            </Text>
          </View>
          <View style={styles.flex} />
          <Text variant="numberLarge" tone="action">
            4:12
          </Text>
        </View>
        <Text variant="caption" tone="muted" style={styles.note}>
          {note}
        </Text>
        <View style={[styles.toggleRow, { borderColor: colors.border }]}>
          <Text variant="label" style={styles.flex}>
            {t('display.numbers')}
          </Text>
          <Toggle value={numbers} onChange={(v) => updatePreferences({ boardNumbers: v })} accessibilityLabel={t('display.numbers')} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12 },
  seg: { marginLeft: 'auto', flexDirection: 'row', gap: 4, padding: 4, borderRadius: 12 },
  segItem: { minHeight: 40, paddingHorizontal: 10, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segLabel: { textTransform: 'none', letterSpacing: 0, fontSize: 11 },
  preview: { flex: 1, justifyContent: 'center', gap: 16, paddingVertical: 16 },
  band: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  center: { alignItems: 'center' },
  flex: { flex: 1 },
  note: { marginHorizontal: 16 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, paddingTop: 12, borderTopWidth: 1, minHeight: 48 },
});
