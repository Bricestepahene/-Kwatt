/** Règles du quartier (acceptées à l'inscription, écran 03 ; lisibles depuis les Paramètres). */
import { LegalDocument } from '@/features/accounts/LegalDocument';

export default function ReglesQuartierScreen() {
  return <LegalDocument doc="rules" />;
}
