/**
 * Écran 10 · Studio d'avatar (planche AvatarStudio) : avatar composé (peau, coiffe, tenue)
 * ou photo, cadre de tissu. Les pièces non possédées s'essaient ; l'action principale devient
 * alors « Acheter · X cauris » (achat puis enregistrement, tout ou rien).
 */
import type { FabricName } from '@kwatt/design';
import type { MyAvatar, ShopItem } from '@kwatt/protocol';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { translateError, useDynamicT, useFormat } from '../../i18n';
import { useIsOffline } from '../../offline';
import { fontFamilies, useTheme } from '../../theme';
import {
  Avatar,
  Button,
  ConfirmSheet,
  Header,
  Icon,
  LoadingState,
  Screen,
  SectionLabel,
  SegmentedTabs,
  Text,
  goBack,
  showToast,
  type AvatarSpec,
} from '../../ui';
import { useBuy, useCatalog, useDeletePhoto, useMyAvatar, useSaveAvatar, useUploadPhoto } from './api';
import { photoFormData, pickSquarePhoto } from './photo';
import { ItemPreview, PurchaseSheet, useItemName } from './ShopParts';
import { LoadError } from './states';
import {
  asComposition,
  fabricOf,
  initialDraft,
  presetSpec,
  previewSpec,
  purchasePlan,
  saveRequest,
  selectedItems,
  splitCatalog,
  studioAction,
  type StudioCatalog,
  type StudioDraft,
} from './studio';

const PREVIEW = 168;

/** Prix ou état d'une pièce (planche : « à toi » en vert, « 150 cauris » en or). */
function usePriceLabel(): (item: ShopItem) => { text: string; tone: 'gain' | 'action' | 'muted' } {
  const { t } = useTranslation('profile');
  const { t: tc } = useTranslation('common');
  const f = useFormat();
  return (item) => {
    if (item.owned) return { text: t('studio.owned'), tone: 'gain' };
    if (item.locked && item.minRank) return { text: t('studio.lockedRank', { rank: tc(`rank.${item.minRank}`) }), tone: 'muted' };
    if (item.price !== null && item.buyable) return { text: t('studio.price', { price: f.caurisAmount(item.price) }), tone: 'action' };
    return { text: t('studio.blocked'), tone: 'muted' };
  };
}

/** Vignette de coiffe ou de tenue (grille de 4, planche AvatarStudio). */
function PartTile({
  label,
  price,
  selected,
  onPress,
  children,
}: {
  label: string;
  price: { text: string; tone: 'gain' | 'action' | 'muted' } | null;
  selected: boolean;
  onPress: () => void;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const { t: tc } = useTranslation('common');
  const color = price?.tone === 'gain' ? colors.gain : price?.tone === 'action' ? colors.actionText : colors.textMuted;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={price ? `${label}, ${price.text}${selected ? `, ${tc('a11y.selected')}` : ''}` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: colors.surface,
          borderColor: selected ? colors.text : colors.border,
          borderWidth: selected ? 2 : 1,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.tileSwatch}>{children}</View>
      <Text variant="caption" style={styles.tileLabel} numberOfLines={2} align="center" maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
      {price ? (
        <Text variant="caption" style={[styles.tilePrice, { color }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {price.text}
        </Text>
      ) : null}
    </Pressable>
  );
}

function StudioBody({ mine, catalog, balance }: { mine: MyAvatar; catalog: StudioCatalog; balance: number }) {
  const { t } = useTranslation('profile');
  const { t: tc } = useTranslation('common');
  const td = useDynamicT();
  const { colors } = useTheme();
  const f = useFormat();
  const offline = useIsOffline();
  const name = useItemName();
  const priceOf = usePriceLabel();
  const save = useSaveAvatar();
  const buy = useBuy();
  const upload = useUploadPhoto();
  const removePhoto = useDeletePhoto();
  const [draft, setDraft] = useState<StudioDraft>(() => initialDraft(mine, catalog));
  const [sheet, setSheet] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [buyError, setBuyError] = useState<unknown>(null);

  const photo = mine.photo;
  const hasPhoto = Boolean(photo?.url);
  const action = studioAction(draft, catalog, balance, hasPhoto);
  const plan = useMemo(() => purchasePlan(selectedItems(draft, catalog), balance), [draft, catalog, balance]);
  const composition = asComposition(draft.selection, catalog);
  const ownedPresets = catalog.presets.filter((p) => p.owned);
  const frameFabric: FabricName | null = draft.frame ? fabricOf(catalog.byCode.get(draft.frame)) : null;

  const preview: AvatarSpec =
    draft.mode === 'photo' && photo?.url ? { kind: 'photo', uri: photo.url } : previewSpec(draft.selection, catalog);

  const finish = async () => {
    await save.mutateAsync(saveRequest(draft));
    showToast(t('studio.saved'), 'success');
    goBack('/profil');
  };

  const onPrimary = async () => {
    if (action.kind === 'buy') {
      setBuyError(null);
      setSheet(true);
      return;
    }
    if (action.kind !== 'save') return;
    try {
      await finish();
    } catch (error) {
      showToast(translateError(error), 'alert');
    }
  };

  const onConfirmPurchase = async () => {
    setBuyError(null);
    try {
      await buy.mutateAsync(plan.items.map((i) => i.code));
    } catch (error) {
      setBuyError(error);
      return;
    }
    setSheet(false);
    try {
      await finish();
    } catch (error) {
      showToast(translateError(error), 'alert');
    }
  };

  const onPick = async (source: 'camera' | 'library') => {
    try {
      const picked = await pickSquarePhoto(source);
      if (picked.kind === 'denied') {
        showToast(t(source === 'camera' ? 'studio.permissionCamera' : 'studio.permissionGallery'), 'alert');
        return;
      }
      if (picked.kind === 'cancelled') return;
      const result = await upload.mutateAsync(await photoFormData(picked.photo));
      setDraft((d) => ({ ...d, mode: 'photo' }));
      showToast(t(result.photo?.status === 'approved' ? 'studio.photoSentApproved' : 'studio.photoSent'), 'success');
    } catch (error) {
      showToast(translateError(error), 'alert');
    }
  };

  const primaryLabel =
    action.kind === 'buy'
      ? t('studio.buy', { price: f.caurisAmount(action.total) })
      : action.kind === 'blocked'
        ? action.item.minRank && action.item.locked
          ? t('studio.blockedRank', { rank: tc(`rank.${action.item.minRank}`) })
          : t('studio.blocked')
        : action.kind === 'needPhoto'
          ? t('studio.needPhoto')
          : t('studio.save');

  const selectComposed = (patch: Partial<{ skin: string; hat: string | null; outfit: string }>) =>
    setDraft((d) => ({ ...d, selection: { ...asComposition(d.selection, catalog), ...patch } }));

  const footer = (
    <View style={styles.footer}>
      <Button label={t('studio.shop')} variant="secondary" size="md" style={styles.shopButton} onPress={() => router.push('/avatar/boutique')} />
      <Button
        label={primaryLabel}
        size="md"
        style={styles.primary}
        disabled={offline || action.kind === 'blocked' || action.kind === 'needPhoto'}
        loading={save.isPending || buy.isPending}
        onPress={() => void onPrimary()}
      />
    </View>
  );

  return (
    <Screen header={<Header title={t('studio.title')} fallback="/profil" />} footer={footer} gap={12}>
      <SegmentedTabs
        options={[
          { value: 'avatar', label: t('studio.modeAvatar') },
          { value: 'photo', label: t('studio.modePhoto') },
        ]}
        value={draft.mode}
        onChange={(mode) => setDraft((d) => ({ ...d, mode }))}
        accessibilityLabel={t('studio.modes')}
      />

      <View style={styles.previewRow}>
        {draft.mode === 'photo' && !photo?.url ? (
          <View style={[styles.placeholder, { borderColor: colors.textMuted }]}>
            <Icon name="camera" size={28} color={colors.textMuted} />
            <Text variant="small" tone="muted" align="center">
              {t('studio.photoPlaceholder')}
            </Text>
          </View>
        ) : (
          <View accessible accessibilityRole="image" accessibilityLabel={t('studio.preview')}>
            <Avatar
              name={null}
              avatar={preview}
              size={PREVIEW}
              frame={frameFabric}
              decorative
              {...(frameFabric ? {} : { ringColor: colors.action })}
            />
          </View>
        )}
      </View>

      {draft.mode === 'avatar' ? (
        <>
          {ownedPresets.length > 0 ? (
            <>
              <SectionLabel>{t('studio.presets')}</SectionLabel>
              <View style={styles.presetRow}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: draft.selection.kind === 'composed' }}
                  accessibilityLabel={t('studio.composed')}
                  onPress={() => setDraft((d) => ({ ...d, selection: asComposition(d.selection, catalog) }))}
                  style={styles.presetChoice}
                >
                  <Avatar
                    name={null}
                    avatar={previewSpec(composition, catalog)}
                    size={56}
                    decorative
                    {...(draft.selection.kind === 'composed' ? { ringColor: colors.action } : {})}
                  />
                </Pressable>
                {ownedPresets.map((p) => {
                  const selected = draft.selection.kind === 'preset' && draft.selection.preset === p.code;
                  return (
                    <Pressable
                      key={p.code}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, checked: selected }}
                      accessibilityLabel={name(p.code)}
                      onPress={() => setDraft((d) => ({ ...d, selection: { kind: 'preset', preset: p.code } }))}
                      style={styles.presetChoice}
                    >
                      <Avatar name={null} avatar={presetSpec(p)} size={56} decorative {...(selected ? { ringColor: colors.action } : {})} />
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          <SectionLabel>{t('studio.skin')}</SectionLabel>
          <View style={styles.skins} accessibilityRole="radiogroup" accessibilityLabel={t('studio.skin')}>
            {catalog.skins.map((skin, index) => {
              const selected = draft.selection.kind === 'composed' && draft.selection.skin === skin.code;
              return (
                <Pressable
                  key={skin.code}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, checked: selected }}
                  accessibilityLabel={t('studio.skinN', { n: index + 1 })}
                  onPress={() => selectComposed({ skin: skin.code })}
                  hitSlop={4}
                  style={[
                    styles.skin,
                    { borderColor: selected ? colors.action : colors.border, borderWidth: selected ? 3 : 2 },
                  ]}
                >
                  <ItemPreview item={skin} size={selected ? 38 : 40} />
                </Pressable>
              );
            })}
          </View>

          <SectionLabel>{t('studio.hat')}</SectionLabel>
          <View style={styles.grid}>
            <PartTile
              label={t('studio.hatNone')}
              price={null}
              selected={draft.selection.kind === 'composed' && draft.selection.hat === null}
              onPress={() => selectComposed({ hat: null })}
            />
            {catalog.hats.map((hat) => (
              <PartTile
                key={hat.code}
                label={name(hat.code)}
                price={priceOf(hat)}
                selected={draft.selection.kind === 'composed' && draft.selection.hat === hat.code}
                onPress={() => selectComposed({ hat: hat.code })}
              >
                <ItemPreview item={hat} size={34} />
              </PartTile>
            ))}
          </View>

          <SectionLabel>{t('studio.outfit')}</SectionLabel>
          <View style={styles.grid}>
            {catalog.outfits.map((outfit) => (
              <PartTile
                key={outfit.code}
                label={name(outfit.code)}
                price={priceOf(outfit)}
                selected={draft.selection.kind === 'composed' && draft.selection.outfit === outfit.code}
                onPress={() => selectComposed({ outfit: outfit.code })}
              >
                <ItemPreview item={outfit} size={34} />
              </PartTile>
            ))}
          </View>
        </>
      ) : (
        <View style={styles.photoBlock}>
          <Button label={t('studio.takePhoto')} variant="tonal" size="md" icon="camera" loading={upload.isPending} disabled={offline} onPress={() => void onPick('camera')} />
          <Button label={t('studio.pickPhoto')} variant="outline" size="md" icon="image" disabled={offline || upload.isPending} onPress={() => void onPick('library')} />
          {photo ? (
            <Text
              variant="small"
              tone={photo.status === 'rejected' ? 'alert' : photo.status === 'approved' ? 'gain' : 'muted'}
              align="center"
              accessibilityLiveRegion="polite"
            >
              {t(photo.status === 'pending' ? 'studio.photoPending' : photo.status === 'approved' ? 'studio.photoApproved' : 'studio.photoRejected')}
            </Text>
          ) : null}
          <Text variant="small" tone="muted" align="center">
            {t('studio.photoHint')}
          </Text>
          {photo?.url ? (
            <Button label={t('studio.deletePhoto')} variant="danger" size="sm" icon="trash" disabled={offline} onPress={() => setConfirmDelete(true)} />
          ) : null}
        </View>
      )}

      <SectionLabel>{t('studio.frame')}</SectionLabel>
      <View style={styles.frames} accessibilityRole="radiogroup" accessibilityLabel={t('studio.frame')}>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: draft.frame === null, checked: draft.frame === null }}
          accessibilityLabel={t('studio.frameNone')}
          onPress={() => setDraft((d) => ({ ...d, frame: null }))}
          style={[
            styles.frame,
            styles.frameNone,
            { borderColor: draft.frame === null ? colors.action : colors.border, borderWidth: draft.frame === null ? 3 : 2 },
          ]}
        >
          <Icon name="close" size={18} color={colors.textMuted} />
        </Pressable>
        {catalog.frames.map((frame) => {
          const selected = draft.frame === frame.code;
          const price = priceOf(frame);
          return (
            <Pressable
              key={frame.code}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected, disabled: frame.locked }}
              accessibilityLabel={t('studio.itemA11y', { name: name(frame.code), state: price.text })}
              disabled={frame.locked}
              onPress={() => setDraft((d) => ({ ...d, frame: frame.code }))}
              style={[
                styles.frame,
                { borderColor: selected ? colors.action : colors.border, borderWidth: selected ? 3 : 2, opacity: frame.locked ? 0.5 : 1 },
              ]}
            >
              <ItemPreview item={frame} size={selected ? 40 : 42} />
              {frame.locked ? (
                <View style={[styles.lock, { backgroundColor: colors.bg }]}>
                  <Icon name="lock" size={12} color={colors.text} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {draft.frame ? (
        <Text variant="caption" tone="muted">
          {td(`items:name.${draft.frame}`, { defaultValue: '' })}
        </Text>
      ) : null}

      <PurchaseSheet
        visible={sheet}
        plan={plan}
        balance={balance}
        saveAfter
        busy={buy.isPending || save.isPending}
        error={buyError}
        onConfirm={() => void onConfirmPurchase()}
        onCancel={() => setSheet(false)}
      />
      <ConfirmSheet
        visible={confirmDelete}
        title={t('studio.deletePhotoTitle')}
        message={t('studio.deletePhotoBody')}
        confirmLabel={t('studio.deletePhoto')}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await removePhoto.mutateAsync();
            setDraft((d) => ({ ...d, mode: 'avatar' }));
            showToast(t('studio.photoDeleted'), 'success');
          } catch (error) {
            showToast(translateError(error), 'alert');
          } finally {
            setConfirmDelete(false);
          }
        }}
      />
    </Screen>
  );
}

export function StudioScreen() {
  const { t } = useTranslation('profile');
  const mine = useMyAvatar();
  const catalog = useCatalog();
  const split = useMemo(() => (catalog.data ? splitCatalog(catalog.data.items) : null), [catalog.data]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (mine.data && split) setReady(true);
  }, [mine.data, split]);

  if (ready && mine.data && split && catalog.data) {
    return <StudioBody mine={mine.data} catalog={split} balance={catalog.data.balance} />;
  }
  const error = mine.error ?? catalog.error;
  return (
    <Screen header={<Header title={t('studio.title')} fallback="/profil" />}>
      {error ? (
        <LoadError
          error={error}
          onRetry={() => {
            void mine.refetch();
            void catalog.refetch();
          }}
        />
      ) : (
        <LoadingState message={t('studio.loading')} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  previewRow: { alignItems: 'center', paddingVertical: 4 },
  placeholder: {
    width: PREVIEW,
    height: PREVIEW,
    borderRadius: PREVIEW / 2,
    borderWidth: 3,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 20,
  },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  presetChoice: { minWidth: 56, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  skins: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  skin: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', gap: 8 },
  tile: {
    flex: 1,
    minHeight: 84,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  tileSwatch: { height: 24, justifyContent: 'center', alignItems: 'center' },
  tileLabel: { fontFamily: fontFamilies.body[700], fontSize: 11, lineHeight: 14 },
  tilePrice: { fontSize: 10, lineHeight: 13 },
  photoBlock: { gap: 12, alignItems: 'stretch' },
  frames: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  frame: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  frameNone: { borderStyle: 'dashed' },
  lock: { position: 'absolute', right: -2, bottom: -2, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  footer: { flexDirection: 'row', gap: 10 },
  shopButton: { flex: 1 },
  primary: { flex: 2 },
});

