/**
 * Pièces communes des écrans Ligues : bandeau sur tissu (obom pour les Dames, kaba pour le
 * Ludo), lignes de réglage, sélecteur −/+, cases à choix, tuiles de chiffres, et l'état
 * d'une requête (chargement, hors connexion, erreur).
 */
import { brand } from '@kwatt/design';
import type { LeagueGame, LeaguePlayer } from '@kwatt/protocol';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Href } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { isApiError } from '../../api/errors';
import { useFormat } from '../../i18n';
import { formatDate } from '../../i18n/format';
import { useTheme } from '../../theme';
import { Avatar, ErrorState, Fabric, Icon, IconButton, LoadingState, OfflineState, Text, goBack } from '../../ui';
import { avatarProps } from '../profile/looks';
import { OnWood, WoodOverlay } from '../dames/FabricHeader';

/** Les matchs se jouent à l'heure du Cameroun, quel que soit le fuseau de l'appareil. */
export const KWATT_TIME_ZONE = 'Africa/Douala';

/** Dates des ligues : jour (« 10 nov. »), jour de la semaine, heure, à l'heure du Cameroun. */
export function useLeagueDates() {
  const { locale } = useFormat();
  return useMemo(() => {
    const noon = (day: string) => new Date(`${day}T12:00:00.000Z`);
    return {
      day: (day: string) => formatDate(noon(day), locale, 'short', KWATT_TIME_ZONE),
      weekday: (day: string) => formatDate(noon(day), locale, 'weekday', KWATT_TIME_ZONE),
      time: (iso: string) => formatDate(new Date(iso), locale, 'time', KWATT_TIME_ZONE),
      dayTime: (iso: string) => formatDate(new Date(iso), locale, 'dayTime', KWATT_TIME_ZONE),
      dateTime: (iso: string) => formatDate(new Date(iso), locale, 'dateTime', KWATT_TIME_ZONE),
    };
  }, [locale]);
}

export const fabricOf = (game: LeagueGame) => (game === 'ludo' ? 'kaba' : 'obom');

/** Bandeau sur tissu : retour, sur-titre, titre, puis ce qu'on y pose (pastilles, duel…). */
export function LeagueBand({
  game,
  kicker,
  title,
  fallback = '/ligues',
  children,
}: {
  game: LeagueGame;
  kicker?: string;
  title?: string;
  fallback?: Href;
  children?: ReactNode;
}) {
  const { t } = useTranslation('common');
  return (
    <Fabric name={fabricOf(game)} style={styles.band}>
      <View style={styles.bandRow}>
        <IconButton icon="back" tone="bg" accessibilityLabel={t('action.back')} onPress={() => goBack(fallback)} />
        <View style={styles.bandTitles}>
          {kicker ? (
            <OnWood variant="caption" numberOfLines={2}>
              {kicker}
            </OnWood>
          ) : null}
          {title ? (
            <Text variant="title" style={styles.onWood} accessibilityRole="header" numberOfLines={2}>
              {title}
            </Text>
          ) : null}
        </View>
      </View>
      {children}
    </Fabric>
  );
}

/** Pastilles « Journée 7 / 18 · Code K7-LIGA · Cagnotte 500 » sur le bois. */
export function WoodChips({ items }: { items: readonly string[] }) {
  return (
    <View style={styles.chips}>
      {items.map((label) => (
        <WoodOverlay key={label} style={styles.chip}>
          <OnWood variant="smallStrong" numberOfLines={1}>
            {label}
          </OnWood>
        </WoodOverlay>
      ))}
    </View>
  );
}

/** Avatar d'un joueur de ligue (apparence du serveur, sinon l'initiale). */
export function PlayerAvatar({ player, size = 40, ringColor }: { player: LeaguePlayer; size?: number; ringColor?: string }) {
  const look = player.avatar ? avatarProps(player.avatar) : null;
  return (
    <Avatar
      name={player.pseudo}
      size={size}
      decorative
      {...(look ? { avatar: look.avatar, frame: look.frame } : {})}
      {...(ringColor ? { ringColor } : {})}
    />
  );
}

/** Groupe de lignes sur une surface. */
export function RowGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return <View style={[styles.group, { backgroundColor: colors.surface }, style]}>{children}</View>;
}

/** Ligne « libellé … valeur », éventuellement touchable (›). */
export function Row({
  label,
  value,
  right,
  onPress,
  last = false,
  accessibilityLabel,
}: {
  label: string;
  value?: string;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const body = (
    <>
      <Text variant="label" style={styles.rowLabel}>
        {label}
      </Text>
      {right ?? (
        <Text variant="labelStrong" style={styles.rowValue} numberOfLines={2}>
          {value}
          {onPress ? ' ›' : ''}
        </Text>
      )}
    </>
  );
  const style = [styles.row, last ? null : { borderBottomWidth: 1, borderBottomColor: colors.border }];
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label}. ${value ?? ''}`}
      onPress={onPress}
      style={({ pressed }) => [...style, { opacity: pressed ? 0.8 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

/** Sélecteur − valeur + (écran 31). */
export function Stepper({
  value,
  onMinus,
  onPlus,
  minusLabel,
  plusLabel,
  minusDisabled,
  plusDisabled,
}: {
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  minusLabel: string;
  plusLabel: string;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
}) {
  const { colors } = useTheme();
  const button = (label: string, icon: 'minus' | 'plus', onPress: () => void, disabled?: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.step, { backgroundColor: colors.surfaceStrong, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }]}
    >
      <Icon name={icon} size={18} />
    </Pressable>
  );
  return (
    <View style={styles.stepper}>
      {button(minusLabel, 'minus', onMinus, minusDisabled)}
      <Text variant="number" style={styles.stepValue} accessibilityLiveRegion="polite">
        {value}
      </Text>
      {button(plusLabel, 'plus', onPlus, plusDisabled)}
    </View>
  );
}

/** Case à choix (format, règle de planche, planche) : bordure ivoire quand elle est choisie. */
export function ChoiceBox({
  selected,
  onPress,
  title,
  sub,
  radio = false,
  role = 'button',
  style,
  children,
}: {
  selected: boolean;
  onPress: () => void;
  title: string;
  sub?: string;
  radio?: boolean;
  role?: 'button' | 'radio';
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={role === 'radio' ? { checked: selected } : { selected }}
      accessibilityLabel={sub ? `${title}. ${sub}` : title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        { backgroundColor: colors.surface, borderColor: selected ? colors.text : colors.border, borderWidth: selected ? 2 : 1, opacity: pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {radio ? <View style={[styles.dot, selected ? { borderWidth: 6, borderColor: colors.action } : { borderWidth: 2, borderColor: colors.textMuted }]} /> : null}
      {children}
      <View style={styles.choiceTexts}>
        <Text variant={radio ? 'bodyStrong' : 'subheading'}>{title}</Text>
        {sub ? (
          <Text variant="small" tone="muted">
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Tuiles « 13 journées · 91 matchs · 22 nov. fin prévue ». */
export function StatTiles({ items }: { items: readonly { value: string; label: string }[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.tiles}>
      {items.map((s) => (
        <View key={s.label} style={[styles.tile, { backgroundColor: colors.surface }]} accessible accessibilityLabel={`${s.value} ${s.label}`}>
          <Text variant="number" numberOfLines={1} adjustsFontSizeToFit>
            {s.value}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {s.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Note encadrée (règle, avertissement en corail, succès). */
export function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'alert' | 'gain' }) {
  const { colors } = useTheme();
  const palette =
    tone === 'alert'
      ? { backgroundColor: colors.lossSoft, borderColor: colors.alert }
      : tone === 'gain'
        ? { backgroundColor: colors.gainSoft, borderColor: colors.gain }
        : { backgroundColor: colors.surfaceStrong, borderColor: colors.border };
  return (
    <View style={[styles.note, palette]}>
      {typeof children === 'string' ? (
        <Text variant="small" style={tone === 'alert' ? { color: colors.lossSoftText } : tone === 'gain' ? { color: colors.gainSoftText } : null}>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

/** Contenu d'une requête : les données, sinon hors connexion, erreur ou chargement. */
export function QueryBody<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError) {
    return !isApiError(query.error) || query.error.isTransient ? (
      <OfflineState onRetry={() => void query.refetch()} />
    ) : (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
  }
  return <LoadingState />;
}

const styles = StyleSheet.create({
  band: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 18, gap: 14 },
  bandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bandTitles: { flex: 1, gap: 2 },
  onWood: { color: brand.raphia },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  group: { borderRadius: 14, paddingHorizontal: 14 },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 },
  rowLabel: { flexShrink: 1 },
  rowValue: { flexShrink: 1, textAlign: 'right' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 48, textAlign: 'center' },
  choice: { borderRadius: 14, padding: 12, gap: 12, flexDirection: 'row', alignItems: 'center' },
  choiceTexts: { flex: 1, gap: 4 },
  dot: { width: 20, height: 20, borderRadius: 10 },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center', gap: 2 },
  note: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
});
