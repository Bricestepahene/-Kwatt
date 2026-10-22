/**
 * Écran 09 « Profil unique » (planche Profil), partagé par ton profil (onglet Profil) et le
 * profil public d'un autre joueur (/joueur/[id], en lecture) :
 * - en-tête ndop : avatar ou photo dans son cadre, pseudo, @pseudo · ville, quartier,
 *   cauris (ou parties), cartes x/48, médailles ;
 * - onglets Dames · Ludo · Raisonnement : échelon, niveau, progression, force, V/N/D ;
 * - derniers matchs, ou la vitrine vide de la planche Matrice.
 */
import { brand, contrastRatio, type FabricName } from '@kwatt/design';
import type { FamilyProfile, GameFamily, Profile, RecentGame, VariantStanding } from '@kwatt/protocol';
import { router, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useDynamicT, useFormat } from '../../i18n';
import { fontFamilies, useTheme } from '../../theme';
import {
  Avatar,
  Button,
  Card,
  Chip,
  Fabric,
  IconButton,
  ProgressBar,
  SectionLabel,
  SegmentedTabs,
  Text,
  goBack,
  type SegmentOption,
} from '../../ui';
import { avatarProps } from './looks';
import { contextLine, isEmptyShowcase, opponentLine, pointsOf, pointsTone, resultBadge, resultTone } from './recent';

const FAMILY_FABRIC: Readonly<Record<GameFamily, FabricName>> = { dames: 'obom', ludo: 'kaba', raisonnement: 'ndop' };

/** Couleur d'accent de chaque jeu (planche : or aux Dames, bleu Wouri au Ludo, gris au Raisonnement). */
function useFamilyAccent(family: GameFamily): { bar: string; text: string } {
  const { colors } = useTheme();
  if (family === 'dames') return { bar: colors.action, text: colors.actionText };
  if (family === 'raisonnement') return { bar: colors.textMuted, text: colors.textMuted };
  // Bleu Wouri : lisible sur la surface de nuit ; en Plein soleil, le texte reprend l'encre.
  const readable = contrastRatio(brand.bleuWouri, colors.surface) >= 4.5;
  return { bar: brand.bleuWouri, text: readable ? brand.bleuWouri : colors.text };
}

export interface ProfileViewProps {
  profile: Profile;
  /** Bandeau au-dessus du contenu (données locales hors connexion…). */
  notice?: ReactNode;
}

/** En-tête de tissu ndop : identité et compteurs. */
function ProfileHeader({ profile }: { profile: Profile }) {
  const { t } = useTranslation('profile');
  const { t: tc } = useTranslation('common');
  const { colors } = useTheme();
  const f = useFormat();
  const look = avatarProps(profile.look);
  const self = profile.self;
  const city = profile.quarter?.city ?? null;
  const handle = city ? t('header.handleCity', { pseudo: profile.pseudo, city }) : t('header.handle', { pseudo: profile.pseudo });
  const quarterName = profile.quarter ? profile.quarter.name : null;

  const avatar = (
    <Avatar
      name={profile.pseudo}
      avatar={look.avatar}
      frame={look.frame}
      size={84}
      decorative={self}
      {...(look.frameRarity === 'legendaire' ? { ringColor: colors.alert } : {})}
    />
  );

  return (
    <Fabric name="ndop" style={styles.header}>
      <View style={[styles.headerTop, self ? styles.end : styles.between]}>
        {self ? (
          <>
            <IconButton icon="friends" tone="bg" accessibilityLabel={t('header.friends')} onPress={() => router.push('/amis')} />
            <IconButton icon="settings" tone="bg" accessibilityLabel={t('header.settings')} onPress={() => router.push('/parametres')} />
          </>
        ) : (
          <>
            <IconButton icon="back" tone="bg" accessibilityLabel={tc('action.back')} onPress={() => goBack('/profil')} />
            <IconButton
              icon="flag"
              tone="bg"
              accessibilityLabel={t('header.report')}
              onPress={() => router.push(`/signaler/${encodeURIComponent(profile.userId)}` as Href)}
            />
          </>
        )}
      </View>

      <View style={styles.identity}>
        <View style={styles.avatarWrap}>
          {self ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('header.editAvatar')}
              onPress={() => router.push('/avatar')}
              hitSlop={4}
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
            >
              {avatar}
            </Pressable>
          ) : (
            avatar
          )}
          {profile.photoPending ? (
            <View style={[styles.pending, { backgroundColor: colors.bg, borderColor: colors.border }]}>
              <Text variant="caption" style={styles.pendingText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {t('header.photoPending')}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.names}>
          <Text variant="display" style={[styles.pseudo, { color: brand.raphia }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {profile.pseudo}
          </Text>
          <Text variant="label" style={{ color: brand.raphia }} numberOfLines={1}>
            {handle}
          </Text>
          {quarterName ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t('header.quarterA11y', { name: quarterName })}
              onPress={() => router.push('/quartiers')}
              hitSlop={8}
            >
              <Text variant="smallStrong" style={[styles.link, { color: brand.raphia }]} numberOfLines={2}>
                {city && city !== quarterName ? t('header.quarterCity', { name: quarterName, city }) : quarterName}
              </Text>
            </Pressable>
          ) : self ? (
            <Pressable accessibilityRole="link" onPress={() => router.push('/quartiers')} hitSlop={8}>
              <Text variant="smallStrong" style={[styles.link, { color: brand.raphia }]}>
                {t('header.chooseQuarter')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.stats}>
        {self ? (
          <StatTile
            value={f.caurisAmount(profile.cauris ?? 0)}
            label={t('stats.cauris')}
            accessibilityLabel={t('stats.caurisA11y', { amount: f.cauris(profile.cauris ?? 0) })}
            onPress={() => router.push('/profil/cauris')}
          />
        ) : (
          <StatTile
            value={f.number(profile.gamesPlayed)}
            label={t('stats.games', { count: profile.gamesPlayed })}
            accessibilityLabel={t('stats.gamesA11y', { count: profile.gamesPlayed })}
          />
        )}
        <StatTile
          value={f.number(profile.cards.owned)}
          suffix={`/${f.number(profile.cards.total)}`}
          label={t('stats.cards')}
          accessibilityLabel={t('stats.cardsA11y', { owned: profile.cards.owned, total: profile.cards.total })}
          {...(self ? { onPress: () => router.push('/cartes') } : {})}
        />
        <StatTile
          value={f.number(profile.medals.total)}
          label={t('stats.medals', { count: profile.medals.total })}
          accessibilityLabel={t('stats.medalsA11y', { count: profile.medals.total })}
          {...(self ? { onPress: () => router.push('/recompenses') } : {})}
        />
      </View>
    </Fabric>
  );
}

function StatTile({
  value,
  suffix,
  label,
  accessibilityLabel,
  onPress,
}: {
  value: string;
  suffix?: string;
  label: string;
  accessibilityLabel: string;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const body = (
    <>
      <Text variant="number" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
        {suffix ? (
          <Text variant="caption" tone="muted">
            {suffix}
          </Text>
        ) : null}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  const style = [styles.tile, { backgroundColor: colors.bg }];
  if (!onPress) {
    return (
      <View style={style} accessible accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [style, { opacity: pressed ? 0.8 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

/** Carte de l'onglet : échelon, niveau, progression, force et bilan. */
function StandingCard({ family, standing }: { family: FamilyProfile; standing: VariantStanding | null }) {
  const { t } = useTranslation('profile');
  const { t: tc } = useTranslation('common');
  const { colors } = useTheme();
  const f = useFormat();
  const accent = useFamilyAccent(family.family);
  const rank = standing ? tc(`rank.${standing.rank}`) : t('family.unranked');
  const level = standing?.level ?? 0;
  const next = standing
    ? t('family.next', { points: f.number(standing.pointsToNextLevel), level: standing.nextLevel })
    : t('family.beta');
  return (
    <Card band={FAMILY_FABRIC[family.family]} bandHeight={14} padding={16} gap={12}>
      <View style={styles.rowBetween}>
        <Text variant="heading" numberOfLines={1} style={styles.shrink}>
          {rank}
        </Text>
        <Text variant="smallStrong" style={[styles.levelText, { color: accent.text }]}>
          {t('family.level', { level })}
        </Text>
      </View>
      <ProgressBar
        value={standing?.progress ?? 0}
        color={accent.bar}
        height={8}
        accessibilityLabel={t('family.progressA11y', { level: standing?.nextLevel ?? 1 })}
      />
      <View style={styles.rowBetween}>
        <Text variant="small" tone="muted" style={styles.shrink}>
          {next}
        </Text>
        <Pressable accessibilityRole="link" onPress={() => router.push('/echelons')} hitSlop={10}>
          <Text variant="smallStrong" tone="action">
            {t('family.ranks')}
          </Text>
        </Pressable>
      </View>
      <View style={styles.record}>
        <RecordCell value={standing ? f.number(standing.rating) : '—'} label={t('family.force')} />
        <RecordCell value={f.number(family.record.wins)} label={t('family.wins')} color={colors.gain} />
        <RecordCell value={f.number(family.record.draws)} label={t('family.draws')} />
        <RecordCell value={f.number(family.record.losses)} label={t('family.losses')} color={colors.alert} />
      </View>
    </Card>
  );
}

function RecordCell({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View style={styles.recordCell} accessible accessibilityLabel={`${value} ${label}`}>
      <Text variant="subheading" style={color ? { color } : null} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text variant="caption" tone="muted" style={styles.recordLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Une ligne « Derniers matchs ». */
function RecentRow({ game, family }: { game: RecentGame; family: GameFamily }) {
  const { t } = useTranslation('profile');
  const td = useDynamicT();
  const { colors } = useTheme();
  const f = useFormat();
  const badge = resultBadge(game);
  const tone = resultTone(game);
  const toneColor = tone === 'gain' ? colors.gain : tone === 'alert' ? colors.alert : colors.textMuted;
  const badgeLabel =
    badge.kind === 'place' ? (badge.place === 1 ? t('recent.place1') : t('recent.placeN', { place: badge.place })) : t(`recent.badge.${badge.result}`);
  const badgeA11y = badge.kind === 'place' ? t('recent.placeA11y', { place: badge.place }) : t(`recent.result.${badge.result}`);
  const who = opponentLine(game);
  const ctx = contextLine(game, family);
  const variant = td(`profile:variant.${game.variant}`);
  const ctxParams: Record<string, unknown> = { ...ctx.params, variant };
  if (typeof ctx.params?.stake === 'number') ctxParams.stake = f.caurisAmount(ctx.params.stake);
  if (typeof ctx.params?.pot === 'number') ctxParams.pot = f.caurisAmount(ctx.params.pot);
  const whoText = td(`profile:${who.key}`, who.params);
  const ctxText = td(`profile:${ctx.key}`, ctxParams);
  const points = pointsOf(game);
  const pointsText = points
    ? t(points.kind === 'cauris' ? 'recent.cauris' : 'recent.rating', { value: f.signed(points.value) })
    : null;
  const pointsColor = points ? (pointsTone(points.value) === 'gain' ? colors.gain : pointsTone(points.value) === 'alert' ? colors.alert : colors.textMuted) : colors.textMuted;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[badgeA11y, whoText, ctxText, pointsText].filter(Boolean).join(', ')}
      accessibilityHint={t('recent.open')}
      onPress={() => router.push(`/partie/${encodeURIComponent(game.gameId)}/revoir` as Href)}
      style={({ pressed }) => [styles.recentRow, { backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={[styles.resultBadge, { backgroundColor: toneColor }]}>
        <Text variant="smallStrong" style={[styles.badgeText, { color: colors.bg }]} maxFontSizeMultiplier={1.2} numberOfLines={1}>
          {badgeLabel}
        </Text>
      </View>
      <View style={styles.recentTexts}>
        <Text variant="smallStrong" numberOfLines={1}>
          {whoText}
        </Text>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {ctxText}
        </Text>
      </View>
      {pointsText ? (
        <Text variant="smallStrong" style={{ color: pointsColor }} numberOfLines={1}>
          {pointsText}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Vitrine vide (planche Matrice) : « Joue ta première partie pour remplir ta vitrine ». */
function EmptyShowcase({ family, self }: { family: GameFamily; self: boolean }) {
  const { t } = useTranslation('profile');
  const { colors } = useTheme();
  const action =
    family === 'dames'
      ? { label: t('family.playDames'), href: '/jouer/dames' as const }
      : family === 'ludo'
        ? { label: t('family.playLudo'), href: '/jouer/ludo' as const }
        : { label: t('family.discoverReasoning'), href: '/raisonnement' as const };
  return (
    <View style={[styles.empty, { borderColor: colors.border }]}>
      <Text variant="label" tone="muted" align="center">
        {self ? t('family.empty') : t('family.emptyOther')}
      </Text>
      {self ? <Button label={action.label} variant="secondary" size="sm" onPress={() => router.push(action.href)} /> : null}
    </View>
  );
}

export function ProfileView({ profile, notice }: ProfileViewProps) {
  const { t } = useTranslation('profile');
  const [tab, setTab] = useState<GameFamily>('dames');
  const [variantByFamily, setVariantByFamily] = useState<Partial<Record<GameFamily, string>>>({});
  const family = profile.games.find((g) => g.family === tab) ?? profile.games[0];
  const options: SegmentOption<GameFamily>[] = profile.games.map((g) => ({ value: g.family, label: t(`tabs.${g.family}`) }));
  if (!family) return null;

  const chosenVariant = variantByFamily[family.family];
  const standing = family.variants.find((v) => v.variant === chosenVariant) ?? family.standing;
  const empty = isEmptyShowcase(family);

  return (
    <View>
      <ProfileHeader profile={profile} />
      <View style={styles.body}>
        {notice}
        <SegmentedTabs options={options} value={family.family} onChange={setTab} accessibilityLabel={t('tabs.label')} />
        {family.variants.length > 1 ? (
          <View style={styles.variants} accessibilityLabel={t('family.variants')}>
            {family.variants.map((v) => (
              <Chip
                key={v.variant}
                label={t(`variant.${v.variant as 'dames10'}`)}
                selected={v.variant === standing?.variant}
                onPress={() => setVariantByFamily((cur) => ({ ...cur, [family.family]: v.variant }))}
              />
            ))}
          </View>
        ) : null}
        <StandingCard family={family} standing={standing} />
        <SectionLabel>{t('family.recent', { game: t(`tabs.${family.family}`) })}</SectionLabel>
        {empty ? (
          <EmptyShowcase family={family.family} self={profile.self} />
        ) : family.recent.length > 0 ? (
          <View style={styles.recentList}>
            {family.recent.map((game) => (
              <RecentRow key={game.gameId} game={game} family={family.family} />
            ))}
          </View>
        ) : (
          <Text variant="small" tone="muted">
            {t('family.emptyOther')}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 22, gap: 14 },
  headerTop: { flexDirection: 'row', gap: 8 },
  end: { justifyContent: 'flex-end' },
  between: { justifyContent: 'space-between' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatarWrap: { alignItems: 'center' },
  pending: { marginTop: -12, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  pendingText: { fontSize: 11, lineHeight: 15 },
  names: { flex: 1, gap: 4 },
  pseudo: { fontSize: 22, lineHeight: 28 },
  link: { textDecorationLine: 'underline' },
  stats: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, minHeight: 56, borderRadius: 12, padding: 10, gap: 2 },
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 14 },
  variants: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  shrink: { flexShrink: 1 },
  levelText: { fontFamily: fontFamilies.display[700] },
  record: { flexDirection: 'row', gap: 8 },
  recordCell: { flex: 1, alignItems: 'center', gap: 2 },
  recordLabel: { fontSize: 11 },
  recentList: { gap: 8 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, minHeight: 56 },
  resultBadge: { minWidth: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { fontFamily: fontFamilies.display[700], fontSize: 12 },
  recentTexts: { flex: 1, gap: 1 },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 14, padding: 16, gap: 12, alignItems: 'center' },
});
