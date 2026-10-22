/**
 * Réglages prêts à poser dans un écran (Paramètres 13, Plein soleil 17, menu d'une
 * partie, Bienvenue pour la langue) : chaque bloc lit et écrit le store des préférences,
 * l'effet est immédiat (thème, langue, sons).
 */
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { setAppLanguage, type Language } from '../i18n';
import { playSound, soundFor } from '../sound';
import { useTheme } from '../theme';
import { ListGroup, ListItem } from '../ui/ListItem';
import { SectionLabel } from '../ui/SectionLabel';
import { SegmentedTabs } from '../ui/SegmentedTabs';
import { Slider } from '../ui/Slider';
import { Text } from '../ui/Text';
import { Toggle } from '../ui/Toggle';
import { updatePreferences, usePreferences, type DiceAnimation, type SoundPack, type ThemeSetting } from './index';

/** Français · English : changement instantané, gardé sur l'appareil. */
export function LanguageSwitch() {
  const { t, i18n } = useTranslation('preferences');
  const language: Language = i18n.language === 'en' ? 'en' : 'fr';
  return (
    <SegmentedTabs<Language>
      accessibilityLabel={t('language.title')}
      value={language}
      onChange={(next) => void setAppLanguage(next)}
      options={[
        { value: 'fr', label: t('language.fr') },
        { value: 'en', label: t('language.en') },
      ]}
    />
  );
}

/** Nuit · Plein soleil · Automatique (SPEC §5), avec la note du mode choisi. */
export function ThemeSwitch({ withNote = true }: { withNote?: boolean }) {
  const { t } = useTranslation('preferences');
  const setting = usePreferences((p) => p.theme);
  const { autoUsesSensor } = useTheme();
  const note =
    setting === 'night'
      ? t('display.nightNote')
      : setting === 'sun'
        ? t('display.sunNote')
        : autoUsesSensor
          ? t('display.autoNoteSensor')
          : t('display.autoNoteSystem');
  return (
    <View style={styles.block}>
      <SegmentedTabs<ThemeSetting>
        accessibilityLabel={t('display.title')}
        value={setting}
        onChange={(theme) => updatePreferences({ theme })}
        options={[
          { value: 'night', label: t('display.night') },
          { value: 'sun', label: t('display.sun') },
          { value: 'auto', label: t('display.auto') },
        ]}
      />
      {withNote ? (
        <Text variant="small" tone="muted">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** Tous les réglages de l'appareil (sons, affichage, jeu, notifications, langue). */
export function PreferencesSettings() {
  const { t } = useTranslation('preferences');
  const prefs = usePreferences((p) => p);

  const pickSound = (soundPack: SoundPack) => {
    updatePreferences({ soundPack });
    const preview = soundFor('move', soundPack);
    if (preview) playSound(preview, prefs.volume);
  };

  return (
    <View style={styles.sections}>
      <SectionLabel>{t('sound.title')}</SectionLabel>
      <SegmentedTabs<SoundPack>
        accessibilityLabel={t('sound.title')}
        value={prefs.soundPack}
        onChange={pickSound}
        options={[
          { value: 'balafon', label: t('sound.balafon'), accessibilityLabel: `${t('sound.balafon')}, ${t('sound.default')}` },
          { value: 'tamtam', label: t('sound.tamtam') },
          { value: 'silence', label: t('sound.silence') },
        ]}
      />
      <ListGroup>
        <ListItem
          label={t('sound.volume')}
          right={
            <Slider
              value={prefs.volume}
              onChange={(volume) => updatePreferences({ volume })}
              accessibilityLabel={t('sound.volume')}
              disabled={prefs.soundPack === 'silence'}
              style={styles.slider}
            />
          }
        />
        <ListItem
          label={t('sound.vibration')}
          right={<Toggle value={prefs.vibration} onChange={(vibration) => updatePreferences({ vibration })} accessibilityLabel={t('sound.vibration')} />}
        />
        <ListItem
          label={t('game.boardNumbers')}
          right={<Toggle value={prefs.boardNumbers} onChange={(boardNumbers) => updatePreferences({ boardNumbers })} accessibilityLabel={t('game.boardNumbers')} />}
        />
        <ListItem
          label={t('game.autoSingleMove')}
          right={
            <Toggle
              value={prefs.autoPlaySingleMove}
              onChange={(autoPlaySingleMove) => updatePreferences({ autoPlaySingleMove })}
              accessibilityLabel={t('game.autoSingleMove')}
            />
          }
        />
      </ListGroup>
      <Text variant="smallStrong">{t('game.diceAnimation')}</Text>
      <SegmentedTabs<DiceAnimation>
        accessibilityLabel={t('game.diceAnimation')}
        value={prefs.diceAnimation}
        onChange={(diceAnimation) => updatePreferences({ diceAnimation })}
        options={[
          { value: 'normal', label: t('game.diceNormal') },
          { value: 'fast', label: t('game.diceFast') },
          { value: 'none', label: t('game.diceNone') },
        ]}
      />

      <SectionLabel>{t('display.title')}</SectionLabel>
      <ThemeSwitch />

      <SectionLabel>{t('notifications.title')}</SectionLabel>
      <ListGroup>
        <ListItem
          label={t('notifications.yourTurn')}
          right={
            <Toggle
              value={prefs.notifications.yourTurn}
              onChange={(yourTurn) => updatePreferences({ notifications: { yourTurn } })}
              accessibilityLabel={t('notifications.yourTurn')}
            />
          }
        />
        <ListItem
          label={t('notifications.roomInvites')}
          right={
            <Toggle
              value={prefs.notifications.roomInvites}
              onChange={(roomInvites) => updatePreferences({ notifications: { roomInvites } })}
              accessibilityLabel={t('notifications.roomInvites')}
            />
          }
        />
        <ListItem
          label={t('notifications.leagueMatches')}
          right={
            <Toggle
              value={prefs.notifications.leagueMatches}
              onChange={(leagueMatches) => updatePreferences({ notifications: { leagueMatches } })}
              accessibilityLabel={t('notifications.leagueMatches')}
            />
          }
        />
      </ListGroup>

      <SectionLabel>{t('language.title')}</SectionLabel>
      <LanguageSwitch />
      <Text variant="small" tone="muted">
        {t('language.hint')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  sections: { gap: 12 },
  slider: { width: 140 },
});
