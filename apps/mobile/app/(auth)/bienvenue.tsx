/**
 * Écran provisoire « Bienvenue » (01) : logo, choix de la langue (un invité n'a pas
 * accès aux Paramètres) et liens vers les écrans d'entrée. Équipe Comptes : voir ROUTES.md.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { PlaceholderScreen } from '@/navigation/PlaceholderScreen';
import { LanguageSwitch } from '@/preferences/QuickSettings';
import { startDemoSession } from '@/session';
import { Button } from '@/ui/Button';
import { Logo, Wordmark } from '@/ui/brand';

export default function BienvenueScreen() {
  const { t } = useTranslation('common');
  const [busy, setBusy] = useState(false);
  return (
    <PlaceholderScreen routeKey="bienvenue" leading="none">
      <View style={styles.brand}>
        <Logo size={112} />
        <Wordmark />
      </View>
      <LanguageSwitch />
      {__DEV__ ? (
        <Button
          label={t('action.demoSession')}
          variant="outline"
          size="sm"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await startDemoSession();
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
    </PlaceholderScreen>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', gap: 16, paddingVertical: 12 },
});
