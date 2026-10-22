/**
 * Écran provisoire « Plein soleil » (17) : le réglage Nuit / Plein soleil / Automatique
 * est déjà branché sur le thème. Équipe Dames : voir ROUTES.md (aperçu du damier à faire).
 */
import { PlaceholderScreen } from '@/navigation/PlaceholderScreen';
import { ThemeSwitch } from '@/preferences/QuickSettings';

export default function AffichageScreen() {
  return (
    <PlaceholderScreen routeKey="affichage">
      <ThemeSwitch />
    </PlaceholderScreen>
  );
}
