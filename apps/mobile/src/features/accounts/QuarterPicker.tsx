/**
 * Choix du quartier (écran 05, étape 2 ; Paramètres) : recherche sans accents dans la liste
 * du serveur (GET /v1/quarters?q=), quartiers des villes du Cameroun et villes de la diaspora.
 */
import type { Quarter } from '@kwatt/protocol';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { isApiError } from '../../api/errors';
import { useDynamicT } from '../../i18n';
import { useTheme } from '../../theme';
import { Icon } from '../../ui/icons/Icon';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { accountKeys, accountsApi } from './api';
import { useDebounced } from './hooks';
import { quarterCity, quarterLabel } from './logic';

/** Nombre de lignes montrées sous le champ. */
const VISIBLE_RESULTS = 6;

function QuarterRow({ quarter, selected, onPress, first }: { quarter: Quarter; selected: boolean; onPress: () => void; first: boolean }) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('accounts');
  const td = useDynamicT();
  const language = i18n.language === 'en' ? 'en' : 'fr';
  const city = quarterCity(quarter, language);
  const country = td(`accounts:countries.${quarter.country}`);
  const title = quarter.name ?? city;
  const subtitle = quarter.name ? `${city} · ${country}` : `${country}`;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={`${quarterLabel(quarter, language)}, ${country}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.border },
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={styles.rowText}>
        <Text variant="labelStrong" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {quarter.name ? subtitle : `${t('quarter.wholeCity')} · ${subtitle}`}
        </Text>
      </View>
      {quarter.players > 0 ? (
        <Text variant="caption" tone="muted">
          {t('quarter.players', { count: quarter.players })}
        </Text>
      ) : null}
      {selected ? <Icon name="check" size={20} color={colors.gain} /> : null}
    </Pressable>
  );
}

export function QuarterPicker({
  value,
  onChange,
  label,
  error,
}: {
  value: Quarter | null;
  onChange: (quarter: Quarter) => void;
  label?: string;
  error?: string | null;
}) {
  const { t, i18n } = useTranslation('accounts');
  const { colors } = useTheme();
  const language = i18n.language === 'en' ? 'en' : 'fr';
  const [query, setQuery] = useState('');
  // Liste ouverte au toucher du champ, fermée au choix (pas à la perte du focus : sur le web,
  // elle arrive avant le toucher de la ligne).
  const [open, setOpen] = useState(false);
  const searching = open || query.length > 0 || value === null;
  const debounced = useDebounced(query, 250);
  const results = useQuery({
    queryKey: accountKeys.quarters(debounced),
    queryFn: ({ signal }) => accountsApi.quarters(debounced, signal),
    enabled: searching,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const items = (results.data?.items ?? []).slice(0, VISIBLE_RESULTS);

  return (
    <View style={styles.wrap}>
      <TextField
        label={label ?? t('quarter.label')}
        value={searching ? query : value ? quarterLabel(value, language) : ''}
        onChangeText={setQuery}
        onFocus={() => setOpen(true)}
        placeholder={t('quarter.placeholder')}
        autoCorrect={false}
        autoCapitalize="words"
        returnKeyType="search"
        error={error}
      />
      {searching ? (
        <View style={[styles.list, { backgroundColor: colors.surface }]} accessibilityRole="radiogroup" accessibilityLabel={label ?? t('quarter.label')}>
          {results.isError && !results.data ? (
            <Text variant="small" tone="muted" style={styles.note}>
              {isApiError(results.error) && results.error.isTransient ? t('quarter.offline') : t('quarter.none')}
            </Text>
          ) : results.isPending ? (
            <View style={[styles.note, styles.inline]}>
              <ActivityIndicator color={colors.textMuted} size="small" />
              <Text variant="small" tone="muted">
                {t('quarter.searching')}
              </Text>
            </View>
          ) : items.length === 0 ? (
            <Text variant="small" tone="muted" style={styles.note}>
              {t('quarter.none')}
            </Text>
          ) : (
            items.map((q, i) => (
              <QuarterRow
                key={q.id}
                quarter={q}
                first={i === 0}
                selected={q.id === value?.id}
                onPress={() => {
                  onChange(q);
                  setQuery('');
                  setOpen(false);
                  Keyboard.dismiss();
                }}
              />
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  list: { borderRadius: 14, overflow: 'hidden' },
  row: { minHeight: 52, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { flex: 1, gap: 1 },
  note: { padding: 14 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
