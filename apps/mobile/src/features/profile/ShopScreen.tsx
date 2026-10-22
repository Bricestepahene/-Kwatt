/**
 * Écran 11 · Boutique d'avatars (planche AvatarBoutique) : solde, édition limitée en
 * bannière (exemplaires partis), filtres de rareté, grille de 3 avatars prêts, achat
 * confirmé puis « Porter maintenant ». Hors connexion : lecture seule (planche Matrice).
 */
import { brand, cauri } from '@kwatt/design';
import type { ShopItem } from '@kwatt/protocol';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { translateError, useDynamicT, useFormat } from '../../i18n';
import { useIsOffline } from '../../offline';
import { fontFamilies, useTheme } from '../../theme';
import {
  Avatar,
  CauriBadge,
  Chip,
  ConfirmSheet,
  Fabric,
  Icon,
  IconButton,
  Screen,
  Skeleton,
  Text,
  goBack,
  showToast,
} from '../../ui';
import { useBuy, useCatalog, useSaveAvatar } from './api';
import { PurchaseSheet, useItemName, useRarityColors } from './ShopParts';
import { LoadError } from './states';
import {
  featuredEdition,
  presetEvent,
  presetSpec,
  purchasePlan,
  SHOP_FILTERS,
  shopButton,
  shopGrid,
  splitCatalog,
  type ShopButton,
  type ShopFilter,
} from './studio';

/** Bannière de l'édition limitée (tissu toghu, planche : « Le Prince du Wouri »). */
function EditionBanner({ item, onPress, disabled }: { item: ShopItem; onPress: () => void; disabled: boolean }) {
  const { t } = useTranslation('profile');
  const td = useDynamicT();
  const { colors } = useTheme();
  const f = useFormat();
  const name = useItemName();
  const event = presetEvent(item);
  const edition = item.edition;
  if (!edition) return null;
  const label = event ? t('shop.limited', { event: td(`items:event.${event}`, { defaultValue: event }) }) : t('shop.limitedNoEvent');
  const detail =
    item.owned && item.serial
      ? t('shop.limitedMine', { serial: f.number(item.serial), total: f.number(edition.total) })
      : edition.sold >= edition.total
        ? t('shop.limitedSoldOut')
        : t('shop.limitedLeft', { sold: f.number(edition.sold), total: f.number(edition.total), price: f.caurisAmount(item.price ?? 0) });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('shop.limitedA11y', { name: name(item.code), detail })}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Fabric name="toghu" style={styles.banner}>
        <Avatar name={null} avatar={presetSpec(item)} size={72} ringColor={colors.action} decorative />
        <View style={[styles.bannerText, { backgroundColor: colors.overlay }]}>
          <Text style={[styles.bannerLabel, { color: brand.orToghu }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
            {label.toLocaleUpperCase()}
          </Text>
          <Text variant="labelStrong" style={{ color: brand.raphia }} numberOfLines={2}>
            {name(item.code)}
          </Text>
          <Text variant="caption" style={{ color: cauri.shell }} numberOfLines={2}>
            {detail}
          </Text>
        </View>
      </Fabric>
    </Pressable>
  );
}

/** Vignette de la grille : anneau de rareté, nom, rareté, bouton prix / « À toi ». */
function ShopCard({ item, balance, offline, onPress }: { item: ShopItem; balance: number; offline: boolean; onPress: () => void }) {
  const { t } = useTranslation('profile');
  const { t: tc } = useTranslation('common');
  const { colors } = useTheme();
  const f = useFormat();
  const name = useItemName();
  const rarity = useRarityColors()(item.rarity);
  const state: ShopButton = shopButton(item, balance);
  const label =
    state === 'owned'
      ? t('shop.owned')
      : state === 'locked' && item.minRank
        ? t('studio.lockedRank', { rank: tc(`rank.${item.minRank}`) })
        : state === 'soldOut'
          ? t('shop.soldOut')
          : f.caurisAmount(item.price ?? 0);
  const a11y =
    state === 'owned'
      ? t('shop.ownedA11y', { name: name(item.code) })
      : state === 'affordable'
        ? t('shop.buyA11y', { name: name(item.code), price: f.caurisAmount(item.price ?? 0) })
        : state === 'tooExpensive'
          ? t('shop.tooExpensiveA11y', {
              name: name(item.code),
              price: f.caurisAmount(item.price ?? 0),
              missing: f.caurisAmount((item.price ?? 0) - balance),
            })
          : state === 'locked' && item.minRank
            ? t('shop.lockedA11y', { name: name(item.code), rank: tc(`rank.${item.minRank}`) })
            : t('shop.soldOutA11y', { name: name(item.code) });
  const disabled = state === 'locked' || state === 'soldOut' || state === 'unavailable' || (offline && state !== 'owned');
  const button =
    state === 'owned'
      ? { bg: 'transparent', fg: colors.gain, border: colors.gainBg }
      : state === 'affordable'
        ? { bg: colors.action, fg: colors.onAction, border: colors.action }
        : { bg: 'transparent', fg: colors.textMuted, border: colors.border };
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={[styles.ring, { backgroundColor: rarity.ring }]}>
        <Avatar name={null} avatar={presetSpec(item)} size={58} decorative />
      </View>
      <Text variant="caption" style={styles.cardName} align="center" numberOfLines={2} maxFontSizeMultiplier={1.3}>
        {name(item.code)}
      </Text>
      <Text style={[styles.cardRarity, { color: rarity.text }]} maxFontSizeMultiplier={1.2} numberOfLines={1}>
        {t(`shop.rarity.${item.rarity}`).toLocaleUpperCase()}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        hitSlop={{ top: 8, bottom: 8 }}
        style={({ pressed }) => [
          styles.cardButton,
          { backgroundColor: button.bg, borderColor: button.border, opacity: pressed ? 0.8 : offline && state !== 'owned' ? 0.6 : 1 },
        ]}
      >
        {state === 'locked' ? <Icon name="lock" size={12} color={button.fg} /> : null}
        <Text variant="smallStrong" style={[styles.cardButtonText, { color: button.fg }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

export function ShopScreen() {
  const { t } = useTranslation('profile');
  const { t: tc } = useTranslation('common');
  const offline = useIsOffline();
  const catalog = useCatalog();
  const buy = useBuy();
  const save = useSaveAvatar();
  const name = useItemName();
  const [filter, setFilter] = useState<ShopFilter>('all');
  const [buying, setBuying] = useState<ShopItem | null>(null);
  const [wearing, setWearing] = useState<ShopItem | null>(null);
  const [buyError, setBuyError] = useState<unknown>(null);

  const split = useMemo(() => (catalog.data ? splitCatalog(catalog.data.items) : null), [catalog.data]);
  const balance = catalog.data?.balance ?? 0;
  const featured = split ? featuredEdition(split.presets) : null;
  const grid = split ? shopGrid(split.presets, filter) : [];
  const allOwned = grid.length > 0 && grid.every((p) => p.owned);
  const plan = buying ? purchasePlan([buying], balance) : null;

  const open = (item: ShopItem) => {
    if (item.owned) setWearing(item);
    else {
      setBuyError(null);
      setBuying(item);
    }
  };

  const confirmBuy = async () => {
    if (!buying) return;
    setBuyError(null);
    try {
      const result = await buy.mutateAsync([buying.code]);
      const serial = result.purchases[0]?.serial ?? null;
      showToast(
        serial ? t('purchase.doneSerial', { name: name(buying.code), serial }) : t('purchase.done', { name: name(buying.code) }),
        'success',
      );
      const bought = result.items[0] ?? buying;
      setBuying(null);
      setWearing(bought);
    } catch (error) {
      setBuyError(error);
    }
  };

  // En-tête de la planche : retour, titre sur une ligne, solde à droite.
  const header = (
    <View style={styles.header}>
      <IconButton icon="back" accessibilityLabel={tc('action.back')} onPress={() => goBack('/avatar')} />
      <Text variant="title" accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.headerTitle}>
        {t('shop.title')}
      </Text>
      {catalog.data ? <CauriBadge amount={balance} size="sm" style={styles.balance} /> : null}
    </View>
  );

  return (
    <Screen header={header} gap={12} onRefresh={() => void catalog.refetch()} refreshing={catalog.isRefetching}>
      {offline ? (
        <Text variant="small" tone="alert">
          {t('purchase.offline')}
        </Text>
      ) : null}
      {catalog.isPending ? (
        <>
          <Skeleton height={100} radius={16} />
          <Skeleton height={36} radius={999} width="70%" />
          <View style={styles.grid}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} height={170} radius={14} style={styles.skeletonCard} />
            ))}
          </View>
        </>
      ) : catalog.isError && !catalog.data ? (
        <LoadError error={catalog.error} onRetry={() => void catalog.refetch()} />
      ) : (
        <>
          {featured ? <EditionBanner item={featured} disabled={offline && !featured.owned} onPress={() => open(featured)} /> : null}
          <View style={styles.filters} accessibilityLabel={t('shop.filters')}>
            {SHOP_FILTERS.map((id) => (
              <Chip key={id} label={t(`shop.filter.${id}`)} selected={filter === id} onPress={() => setFilter(id)} />
            ))}
          </View>
          {allOwned ? (
            <View accessibilityLiveRegion="polite">
              <Text variant="labelStrong" tone="gain">
                {t('shop.allOwned')}
              </Text>
              <Text variant="small" tone="muted">
                {t('shop.allOwnedBody')}
              </Text>
            </View>
          ) : null}
          {grid.length === 0 ? (
            <Text variant="label" tone="muted" align="center">
              {t('shop.empty')}
            </Text>
          ) : (
            <View style={styles.grid}>
              {grid.map((item) => (
                <ShopCard key={item.code} item={item} balance={balance} offline={offline} onPress={() => open(item)} />
              ))}
            </View>
          )}
          <Text variant="caption" tone="muted" align="center" style={styles.footnote}>
            {t('shop.footnote')}
          </Text>
        </>
      )}

      <PurchaseSheet
        visible={buying !== null}
        plan={plan}
        balance={balance}
        busy={buy.isPending}
        error={buyError}
        onConfirm={() => void confirmBuy()}
        onCancel={() => setBuying(null)}
      />
      <ConfirmSheet
        visible={wearing !== null}
        tone="primary"
        title={wearing ? t('purchase.wearTitle', { name: name(wearing.code) }) : ''}
        message={t('purchase.wearBody')}
        confirmLabel={t('purchase.wear')}
        onCancel={() => setWearing(null)}
        onConfirm={async () => {
          if (!wearing) return;
          try {
            await save.mutateAsync({ mode: 'avatar', selection: { kind: 'preset', preset: wearing.code } });
            showToast(t('purchase.worn'), 'success');
          } catch (error) {
            showToast(translateError(error), 'alert');
          } finally {
            setWearing(null);
          }
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  headerTitle: { flex: 1 },
  balance: { alignSelf: 'center' },
  banner: { borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14 },
  bannerText: { flex: 1, gap: 3, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10 },
  bannerLabel: { fontFamily: fontFamilies.body[700], fontSize: 11, lineHeight: 15, letterSpacing: 1.3 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  skeletonCard: { width: '31%' },
  card: { width: '31%', flexGrow: 1, maxWidth: '33%', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 5 },
  ring: { width: 64, height: 64, borderRadius: 32, padding: 3, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontFamily: fontFamilies.body[700], lineHeight: 15, minHeight: 30, textAlignVertical: 'center' },
  cardRarity: { fontFamily: fontFamilies.display[700], fontSize: 9, lineHeight: 12, letterSpacing: 0.4 },
  cardButton: {
    marginTop: 'auto',
    minHeight: 36,
    alignSelf: 'stretch',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  cardButtonText: { fontSize: 12 },
  footnote: { marginTop: 4 },
});
