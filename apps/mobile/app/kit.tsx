/**
 * Catalogue du kit de composants (développement et captures d'écran) : tous les
 * composants de src/ui, dans le thème et la langue courants. Visible en
 * développement ou avec EXPO_PUBLIC_SHOW_KIT=1 ; ailleurs, renvoie à l'accueil.
 */
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { LanguageSwitch, ThemeSwitch } from '@/preferences/QuickSettings';
import { useTheme } from '@/theme';
import {
  Avatar,
  Badge,
  BottomSheet,
  BottomTabBar,
  Button,
  CauriBadge,
  Card,
  Chip,
  CodeInput,
  ConfirmSheet,
  EmptyState,
  ErrorState,
  Fabric,
  FABRICS,
  GameBand,
  Header,
  Icon,
  IconButton,
  ICON_NAMES,
  ListGroup,
  ListItem,
  LoadingState,
  Logo,
  OfflineState,
  Pill,
  ProgressBar,
  RankBadge,
  RoomCodeInput,
  Screen,
  SectionLabel,
  SegmentedTabs,
  showToast,
  Skeleton,
  Slider,
  TAB_ICONS,
  Text,
  TextField,
  Toggle,
  Wordmark,
} from '@/ui';

const SHOW_KIT = __DEV__ || process.env.EXPO_PUBLIC_SHOW_KIT === '1';

export default function KitScreen() {
  if (!SHOW_KIT) return <Redirect href="/" />;
  return <KitCatalogue />;
}

function KitCatalogue() {
  const { t } = useTranslation('common');
  const { colors } = useTheme();
  const [space, setSpace] = useState<'dames' | 'ludo' | 'raisonnement'>('dames');
  const [toggle, setToggle] = useState(true);
  const [volume, setVolume] = useState(0.7);
  const [otp, setOtp] = useState('4829');
  const [room, setRoom] = useState('M4TK9');
  const [chip, setChip] = useState('all');
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);

  return (
    <Screen header={<Header title="Kit Kwatt" subtitle="src/ui" />}>
      <View style={styles.center}>
        <Logo size={96} />
        <Wordmark size="small" />
      </View>
      <LanguageSwitch />
      <ThemeSwitch withNote={false} />

      <SectionLabel>Boutons</SectionLabel>
      <Button label={t('action.join')} />
      <View style={styles.row}>
        <Button label={t('action.join')} variant="secondary" size="md" style={styles.flex} />
        <Button label={t('action.enter')} variant="tonal" size="md" style={styles.flex} />
      </View>
      <View style={styles.row}>
        <Button label={t('action.cancel')} variant="outline" size="sm" style={styles.flex} />
        <Button label={t('action.delete')} variant="danger" size="sm" style={styles.flex} />
      </View>
      <View style={styles.row}>
        <Button label={t('action.save')} loading size="sm" style={styles.flex} />
        <Button label={t('action.save')} disabled size="sm" style={styles.flex} />
        <Button label={t('action.copy')} variant="ghost" size="sm" />
      </View>
      <View style={styles.row}>
        <IconButton icon="back" accessibilityLabel={t('action.back')} />
        <IconButton icon="bell" badge accessibilityLabel={t('a11y.notificationsNone')} />
        <IconButton icon="share" accessibilityLabel={t('action.share')} />
        <IconButton icon="settings" tone="plain" accessibilityLabel="settings" />
      </View>

      <SectionLabel>Pastilles</SectionLabel>
      <View style={styles.wrap}>
        <Pill>Ludo · 4</Pill>
        <CauriBadge amount={2450} />
        <CauriBadge amount={2450} withLabel size="sm" />
        <RankBadge level={17} />
        <RankBadge level={11} />
        <Badge label={t('badge.profileRequired')} display={false} />
        <Badge label={t('badge.beta')} tone="action" />
        <Badge label="DAMES" tone="ndop" />
      </View>
      <View style={styles.wrap}>
        {(['all', 'tables', 'pions'] as const).map((value) => (
          <Chip key={value} label={value} selected={chip === value} onPress={() => setChip(value)} />
        ))}
      </View>
      <SegmentedTabs
        accessibilityLabel={t('space.label')}
        value={space}
        onChange={setSpace}
        options={[
          { value: 'dames', label: t('space.dames') },
          { value: 'ludo', label: t('space.ludo') },
          { value: 'raisonnement', label: t('space.raisonnement') },
        ]}
      />
      <ProgressBar value={0.62} accessibilityLabel="62 %" />

      <SectionLabel>Avatars</SectionLabel>
      <View style={styles.row}>
        <Avatar name="brice_237" />
        <Avatar name="Mireille" frame="ndop" size={56} />
        <Avatar name="Armand" frame="toghu" size={72} ringColor={colors.action} />
        <Avatar name="Tata Odile" avatar={{ kind: 'composed', skin: 2, hat: 'toghu', outfit: 'kaba' }} frame="obom" size={84} />
      </View>

      <SectionLabel>Champs</SectionLabel>
      <TextField label="Pseudo" placeholder="brice_237" hint="3 à 20 caractères" />
      <TextField label="Mot de passe" password defaultValue="secret12" error={t('field.required')} />
      <CodeInput value={otp} onChange={setOtp} />
      <RoomCodeInput value={room} onChange={setRoom} />

      <SectionLabel>Listes</SectionLabel>
      <ListGroup>
        <ListItem label="Pseudo" value="brice_237" />
        <ListItem label="Vibration" right={<Toggle value={toggle} onChange={setToggle} accessibilityLabel="Vibration" />} />
        <ListItem label="Volume" right={<Slider value={volume} onChange={setVolume} accessibilityLabel="Volume" style={styles.slider} />} />
        <ListItem label="Notifications" icon="bell" chevron onPress={() => showToast(t('action.copied'), 'success')} />
      </ListGroup>

      <SectionLabel>Tissus</SectionLabel>
      <View style={styles.wrap}>
        {FABRICS.map((name) => (
          <View key={name} style={styles.swatchWrap}>
            <Fabric name={name} style={styles.swatch} />
            <Text variant="caption" tone="muted">
              {t(`fabric.${name}`)}
            </Text>
          </View>
        ))}
      </View>
      <GameBand space="dames" />
      <GameBand space="ludo" />
      <GameBand space="hub" />
      <Card band="kaba">
        <Text variant="subheading">Card · kaba</Text>
        <Text variant="label" tone="muted">
          {t('placeholder.body')}
        </Text>
      </Card>
      <Card highlighted>
        <Text variant="subheading">Card · « à toi »</Text>
      </Card>

      <SectionLabel>Icônes</SectionLabel>
      <View style={styles.wrap}>
        {ICON_NAMES.map((name) => (
          <View key={name} style={[styles.iconCell, { backgroundColor: colors.surface }]}>
            <Icon name={name} size={22} />
          </View>
        ))}
      </View>

      <SectionLabel>États</SectionLabel>
      <Card padding={0}>
        <EmptyState compact />
      </Card>
      <Card padding={0}>
        <LoadingState compact />
      </Card>
      <Card padding={0}>
        <ErrorState compact onRetry={() => undefined} />
      </Card>
      <Card padding={0}>
        <OfflineState compact />
      </Card>
      <Skeleton height={56} radius={14} />

      <SectionLabel>Feuilles et messages</SectionLabel>
      <View style={styles.row}>
        <Button label="BottomSheet" variant="outline" size="sm" style={styles.flex} onPress={() => setSheet(true)} />
        <Button label="ConfirmSheet" variant="outline" size="sm" style={styles.flex} onPress={() => setConfirm(true)} />
        <Button label="Toast" variant="outline" size="sm" style={styles.flex} onPress={() => showToast(t('offline.back'), 'success')} />
      </View>
      <BottomSheet visible={sheet} onClose={() => setSheet(false)} accessibilityLabel="BottomSheet">
        <Text variant="title">{t('placeholder.title')}</Text>
        <Text variant="label" tone="muted">
          {t('placeholder.body')}
        </Text>
        <Button label={t('action.close')} onPress={() => setSheet(false)} />
      </BottomSheet>
      <ConfirmSheet
        visible={confirm}
        title={t('action.delete')}
        message={t('placeholder.body')}
        confirmLabel={t('action.confirm')}
        onConfirm={() => setConfirm(false)}
        onCancel={() => setConfirm(false)}
      />

      <SectionLabel>Barre du bas</SectionLabel>
      <View style={styles.tabBar}>
        <BottomTabBar
          accessibilityLabel={t('tabs.navigation')}
          items={(['home', 'play', 'leagues', 'cards', 'profile'] as const).map((tab, index) => ({
            key: tab,
            label: t(`tabs.${tab}`),
            icon: TAB_ICONS[tab],
            selected: index === 0,
            badge: tab === 'leagues',
            onPress: () => undefined,
          }))}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  slider: { width: 140 },
  swatchWrap: { gap: 4, alignItems: 'center' },
  swatch: { width: 72, height: 56, borderRadius: 12 },
  iconCell: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tabBar: { borderRadius: 14, overflow: 'hidden' },
});
