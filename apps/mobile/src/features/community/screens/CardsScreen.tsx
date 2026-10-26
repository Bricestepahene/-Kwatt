/**
 * Écran 39 · Cartes (planche Cartes, onglet) : « 14 / 48 gagnées », filtres Toutes · Tables ·
 * Plateaux · Pions · Pouvoirs, grille de cartes (tissu et liseré de rareté si possédée, cadenas
 * sinon). Toucher une carte ouvre sa fiche : comment l'obtenir, son effet, son numéro
 * d'édition, et Équiper pour un habillage (plateau, pions, dé).
 */
import { rarity as rarityColors } from '@kwatt/design';
import type { Card } from '@kwatt/protocol';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';
import { BottomSheet, Button, Chip, EmptyState, Fabric, Icon, Screen, Text, showToast } from '@/ui';
import { QueryBody } from '../../leagues/components';
import { useCards, useEquip } from '../api';
import { CARD_FILTERS, cardEffect, filterCards, sortCards, unlockHint, type CardFilter } from '../logic';

function useCardText() {
  const { t } = useTranslation('community');
  const { t: ti } = useTranslation('items');
  const { t: tc } = useTranslation('common');
  return {
    name: (c: Card) => ti(`name.${c.code}` as 'name.card_table_village'),
    effect: (c: Card) => {
      const e = cardEffect(c);
      const params = 'fabric' in e.params ? { ...e.params, fabric: tc(`fabric.${String(e.params.fabric)}` as 'fabric.ndop') } : e.params;
      return t(e.key as 'cards.effect.trophy', params);
    },
    hint: (c: Card) => {
      const h = unlockHint(c);
      const params = 'rank' in h.params ? { rank: tc(`rank.${String(h.params.rank)}` as 'rank.apprenti') } : h.params;
      return t(h.key as 'cards.how.start', params);
    },
    game: (c: Card) => t(`cards.game.${c.game}`),
    rarity: (c: Card) => tc(`rarity.${c.rarity}`),
  };
}

function CardArt({ card, big = false }: { card: Card; big?: boolean }) {
  const { colors } = useTheme();
  const height = big ? 180 : 118;
  if (!card.owned)
    return (
      <View style={[styles.art, { height, backgroundColor: colors.bg }]}>
        <Icon name="lock" size={big ? 32 : 24} color={colors.textMuted} />
      </View>
    );
  return (
    <View style={[styles.art, { height, borderColor: rarityColors[card.rarity], borderWidth: 2 }]}>
      <Fabric name={card.fabric} style={StyleSheet.absoluteFill} />
      {card.equipped ? (
        <View style={[styles.equipped, { backgroundColor: colors.action }]}>
          <Icon name="check" size={14} color={colors.onAction} strokeWidth={3} />
        </View>
      ) : null}
    </View>
  );
}

function CardTile({ card, onPress }: { card: Card; onPress: () => void }) {
  const text = useCardText();
  const { t } = useTranslation('community');
  const name = text.name(card);
  const line = card.owned ? text.effect(card) : text.hint(card);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}. ${text.rarity(card)}. ${card.owned ? '' : `${t('cards.locked')}. `}${line}`}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.85 : 1 }]}
    >
      <CardArt card={card} />
      <Text variant="labelStrong" numberOfLines={1} tone={card.owned ? 'default' : 'muted'}>
        {name}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={2}>
        {line}
      </Text>
      <Text variant="caption" style={{ color: card.owned ? rarityColors[card.rarity] : undefined }} tone={card.owned ? 'default' : 'muted'}>
        {`${text.rarity(card)} · ${text.game(card)}`}
      </Text>
    </Pressable>
  );
}

function CardSheet({ card, onClose }: { card: Card | null; onClose: () => void }) {
  const { t } = useTranslation('community');
  const text = useCardText();
  const equip = useEquip();
  if (!card) return <BottomSheet visible={false} onClose={onClose} accessibilityLabel="">{null}</BottomSheet>;
  const name = text.name(card);
  return (
    <BottomSheet visible onClose={onClose} accessibilityLabel={name}>
      <View style={styles.sheet}>
        <CardArt card={card} big />
        <Text variant="title">{name}</Text>
        <Text variant="smallStrong" style={card.owned ? { color: rarityColors[card.rarity] } : undefined} tone={card.owned ? 'default' : 'muted'}>
          {`${text.rarity(card)} · ${text.game(card)}`}
        </Text>
        <Text variant="body">{card.owned ? text.effect(card) : text.hint(card)}</Text>
        {card.owned && card.how !== 'start' ? (
          <Text variant="small" tone="muted">
            {text.hint(card)}
          </Text>
        ) : null}
        {card.edition ? (
          <Text variant="small" tone="muted">
            {card.serial ? t('cards.serial', { serial: card.serial, total: card.edition.total }) : t('cards.edition', { total: card.edition.total })}
          </Text>
        ) : null}
        {card.type === 'pouvoir' ? (
          <Text variant="caption" tone="muted">
            {t('cards.powerNote')}
          </Text>
        ) : null}
        {card.owned && card.slot ? (
          <Button
            label={card.equipped ? t('cards.unequip') : t('cards.equip')}
            variant={card.equipped ? 'outline' : 'primary'}
            loading={equip.isPending}
            onPress={() =>
              card.slot &&
              equip.mutate(
                { slot: card.slot, code: card.equipped ? null : card.code },
                {
                  onSuccess: () => {
                    if (!card.equipped) showToast(t('cards.equippedToast', { name }), 'success');
                    onClose();
                  },
                },
              )
            }
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}

export function CardsScreen() {
  const { t } = useTranslation('community');
  const cards = useCards();
  const [filter, setFilter] = useState<CardFilter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const selected = cards.data?.items.find((c) => c.code === open) ?? null;

  return (
    <Screen
      testID="screen-cartes"
      edges={['top']}
      refreshing={cards.isRefetching}
      onRefresh={() => void cards.refetch()}
      header={
        <View style={styles.titleRow}>
          <Text variant="display" accessibilityRole="header">
            {t('cards.title')}
          </Text>
          {cards.data ? (
            <Text variant="small" tone="muted" accessibilityLabel={t('cards.count', { owned: cards.data.owned, total: cards.data.total })}>
              <Text variant="labelStrong">{cards.data.owned}</Text>
              {` ${t('cards.countTotal', { total: cards.data.total })}`}
            </Text>
          ) : null}
        </View>
      }
    >
      <View style={styles.filters} accessibilityLabel={t('cards.filters')}>
        {CARD_FILTERS.map((k) => (
          <Chip key={k} label={t(`cards.filter.${k}`)} selected={filter === k} onPress={() => setFilter(k)} />
        ))}
      </View>
      <QueryBody query={cards}>
        {(data) => {
          const list = sortCards(filterCards(data.items, filter));
          return list.length === 0 ? (
            <EmptyState icon="cards" title={t('cards.emptyTitle')} message={t('cards.emptyMessage')} />
          ) : (
            <View style={styles.grid}>
              {list.map((c) => (
                <CardTile key={c.code} card={c} onPress={() => setOpen(c.code)} />
              ))}
            </View>
          );
        }}
      </QueryBody>
      <Button label={t('cards.rewards')} variant="tonal" icon="trophy" onPress={() => router.push('/recompenses' as Href)} />
      <CardSheet card={selected} onClose={() => setOpen(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16 },
  tile: { width: '48%', gap: 4 },
  art: { borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  equipped: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sheet: { gap: 10 },
});
