/**
 * Écran provisoire « Paramètres » (13) : les réglages de l'appareil sont déjà
 * branchés (sons, affichage, jeu, notifications, langue). Équipe Comptes : voir ROUTES.md
 * (compte, mot de passe, export et suppression restent à faire).
 */
import { PlaceholderScreen } from '@/navigation/PlaceholderScreen';
import { PreferencesSettings } from '@/preferences/QuickSettings';

export default function ParametresScreen() {
  return (
    <PlaceholderScreen routeKey="parametres">
      <PreferencesSettings />
    </PlaceholderScreen>
  );
}
