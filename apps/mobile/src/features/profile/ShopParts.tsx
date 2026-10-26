/**
 * Briques partagées du Studio (écran 10) et de la Boutique (écran 11) : couleurs de rareté
 * lisibles dans les deux thèmes, aperçu d'un objet (pièce de tissu, avatar prêt, cadre),
 * nom traduit d'un objet et feuille de confirmation d'achat (« Il te manque X cauris »).
 */
import { avatarSkins, contrastRatio, rarity as rarityTokens } from '@kwatt/design';
import type { ItemRarity, ShopItem } from '@kwatt/protocol';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { translateError, useDynamicT, useFormat } from '../../i18n';
import { useIsOffline } from '../../offline';
import { useTheme } from '../../theme';
import { Avatar, BottomSheet, Button, CauriIcon, Fabric, Text } from '../../ui';
import { fabricOf, hatRender, presetSpec, skinTone, type PurchasePlan } from './studio';

/** Nom traduit d'un objet (`items:name.<code>`), avec un repli pour un code inconnu de l'appli. */
export function useItemName(): (code: string) => string {
  const td = useDynamicT();
  return useCallback((code: string) => td(`items:name.${code}`, { defaultValue: td('items:unknown') }), [td]);
}

/** Couleur de rareté : anneau (graphisme) et texte (lisible à 4,5:1 sur la surface, sinon l'encre). */
export function useRarityColors(): (rarity: ItemRarity) => { ring: string; text: string } {
  const { colors } = useTheme();
  return useCallback(
    (rarity: ItemRarity) => {
      const token = rarity === 'commune' ? colors.inverse : rarityTokens[rarity];
      const readable = contrastRatio(token, colors.surface) >= 4.5;
      return { ring: token, text: readable ? token : colors.text };
    },
    [colors],
  );
}

/** Aperçu d'un objet du catalogue, dans un carré de `size`. */
export function ItemPreview({ item, size }: { item: ShopItem; size: number }) {
  const { colors } = useTheme();
  switch (item.kind) {
    case 'avatar_preset':
      return <Avatar name={null} avatar={presetSpec(item)} size={size} decorative />;
    case 'avatar_skin':
      return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: avatarSkins[skinTone(item)] }} />;
    case 'avatar_hat': {
      const hat = hatRender(item);
      return hat ? (
        <Fabric
          name={hat.fabric}
          scale={0.6}
          style={[styles.hatSwatch, { width: size, height: Math.round(size * 0.6), borderColor: colors.border }]}
        />
      ) : null;
    }
    case 'avatar_outfit':
    case 'frame': {
      const fabric = fabricOf(item);
      if (!fabric) return null;
      return item.kind === 'frame' ? (
        <Fabric name={fabric} style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        <Fabric name={fabric} scale={0.6} style={[styles.outfitSwatch, { width: size, height: Math.round(size * 0.65) }]} />
      );
    }
    default:
      return null;
  }
}

/**
 * Confirmation d'achat : objets et prix, solde avant et après ; si le solde ne suffit pas,
 * « Il te manque X cauris » et l'achat est impossible (aucun cauri n'est débité).
 */
export function PurchaseSheet({
  visible,
  plan,
  balance,
  saveAfter = false,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  plan: PurchasePlan | null;
  balance: number;
  /** « Acheter et enregistrer » (Studio). */
  saveAfter?: boolean;
  busy: boolean;
  error: unknown;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('profile');
  const { t: tc } = useTranslation('common');
  const { colors } = useTheme();
  const f = useFormat();
  const name = useItemName();
  const offline = useIsOffline();
  const total = plan?.total ?? 0;
  const missing = Math.max(0, total - balance);
  return (
    <BottomSheet visible={visible} onClose={busy ? () => undefined : onCancel} accessibilityLabel={t('purchase.title')}>
      <Text variant="title" accessibilityRole="header">
        {t('purchase.title')}
      </Text>
      <View style={styles.lines}>
        {(plan?.items ?? []).map((item) => (
          <View key={item.code} style={styles.line}>
            <View style={styles.preview}>
              <ItemPreview item={item} size={36} />
            </View>
            <Text variant="labelStrong" style={styles.grow} numberOfLines={2}>
              {name(item.code)}
            </Text>
            <Text variant="label">{f.cauris(item.price ?? 0)}</Text>
          </View>
        ))}
      </View>
      <View style={[styles.sums, { borderColor: colors.border }]}>
        <SumLine label={t('purchase.total')} value={f.cauris(total)} strong />
        <SumLine label={t('purchase.balance')} value={f.cauris(balance)} />
        {missing === 0 ? <SumLine label={t('purchase.after')} value={f.cauris(balance - total)} /> : null}
      </View>
      {missing > 0 ? (
        <Text variant="labelStrong" tone="alert" accessibilityRole="alert">
          {t('purchase.missing', { amount: f.cauris(missing) })}
        </Text>
      ) : null}
      {offline ? (
        <Text variant="small" tone="alert">
          {t('purchase.offline')}
        </Text>
      ) : null}
      {error ? (
        <Text variant="small" tone="alert" accessibilityRole="alert">
          {`${translateError(error)} ${t('purchase.refused')}`}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          label={t(saveAfter ? 'purchase.confirmSave' : 'purchase.confirm', { price: f.caurisAmount(total) })}
          icon="check"
          disabled={missing > 0 || offline || total === 0}
          loading={busy}
          onPress={onConfirm}
        />
        <Button label={tc('action.cancel')} variant="secondary" disabled={busy} onPress={onCancel} />
      </View>
    </BottomSheet>
  );
}

function SumLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.sumLine}>
      <Text variant={strong ? 'labelStrong' : 'label'} tone={strong ? 'default' : 'muted'}>
        {label}
      </Text>
      <View style={styles.sumValue}>
        {strong ? <CauriIcon size={14} /> : null}
        <Text variant={strong ? 'labelStrong' : 'label'}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hatSwatch: { borderTopLeftRadius: 999, borderTopRightRadius: 999, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, borderWidth: 1 },
  outfitSwatch: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  lines: { gap: 10 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  preview: { width: 40, alignItems: 'center' },
  grow: { flex: 1 },
  sums: { borderTopWidth: 1, paddingTop: 12, gap: 6 },
  sumLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sumValue: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { gap: 10 },
});
