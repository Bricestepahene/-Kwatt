/** Politique de confidentialité (acceptée à l'inscription, écran 03 ; lisible depuis les Paramètres). */
import { LegalDocument } from '@/features/accounts/LegalDocument';

export default function ConfidentialiteScreen() {
  return <LegalDocument doc="privacy" />;
}
