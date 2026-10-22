/**
 * Génère apps/mobile/ROUTES.md depuis la table des routes (routes.ts).
 * Le test routes.test.ts vérifie que le fichier est à jour ; pour le réécrire :
 *   pnpm --filter @kwatt/mobile routes:doc
 * Module pur.
 */
import { ROUTES, type AccessLevel, type RouteSpec, type Team } from './routes';

const ACCESS_LABELS: Record<AccessLevel, string> = {
  public: 'Tout le monde',
  signedOut: 'Sans profil (sans session ou invité)',
  guest: 'Session (invité ou profil)',
  member: 'Profil',
  adult: 'Profil, 18 ans et plus',
};

const TEAM_LABELS: Record<Team, string> = {
  'fondation-appli': 'Fondation appli',
  comptes: 'Comptes',
  profil: 'Profil',
  dames: 'Dames',
  ludo: 'Ludo',
  'parties-en-ligne': 'Parties en ligne',
  ligues: 'Ligues',
  communaute: 'Communauté et progression',
};

/** Ordre du Sommaire : 01, 02… avec les écrans « b » et « c » à leur place. */
export function screenOrder(screen: string): number {
  const match = /^(\d+)([a-z]?)$/.exec(screen);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const letter = match[2] ? match[2].charCodeAt(0) - 96 : 0;
  return Number(match[1]) * 10 + letter;
}

function routeOrder(route: RouteSpec): number {
  return route.screens.length > 0 ? Math.min(...route.screens.map(screenOrder)) : Number.MAX_SAFE_INTEGER;
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function renderRoutesMarkdown(routes: readonly RouteSpec[] = ROUTES): string {
  const sorted = [...routes].sort((a, b) => routeOrder(a) - routeOrder(b));
  const lines: string[] = [];
  lines.push('# Routes de l’appli Kwatt');
  lines.push('');
  lines.push('<!-- Fichier généré depuis src/navigation/routes.ts : ne pas modifier à la main. -->');
  lines.push('<!-- Pour le réécrire : pnpm --filter @kwatt/mobile routes:doc -->');
  lines.push('');
  lines.push('Chaque écran du Sommaire (`docs/maquette/README.md`) a sa route, déjà branchée sur la navigation, la garde de session et les traductions (`screens:<clé>.title` et `.lead`). Chaque équipe **remplace le contenu du fichier de route** par son écran, sans changer son chemin ; la logique va dans `src/features/<nom>/`, les textes dans `src/i18n/locales/{fr,en}/<nom>.json`.');
  lines.push('');
  lines.push('- **Groupes** : `(auth)` pour l’entrée dans l’appli (01–06), `(tabs)` pour les cinq onglets (Accueil, Jouer, Ligues, Cartes, Profil), les autres écrans s’empilent par-dessus (sans barre du bas, comme pendant une partie).');
  lines.push('- **Jouer** (`/jouer`) rouvre le dernier espace utilisé (Dames par défaut), gardé dans les préférences (`lastSpace`).');
  lines.push('- **Garde de session** (`src/navigation/SessionGate.tsx`, règles dans `access.ts`) : sans session → Bienvenue (avec `?next=` pour revenir) ; invité → seulement les routes « Session » ou « Tout le monde » ; « 18 ans et plus » → retour à l’accueil avec un message. Après une connexion, l’écran d’entrée déclare la suite avec `setAfterSignIn(chemin)` (`src/navigation/intent.ts`) au lieu de naviguer lui-même.');
  lines.push('- **Liens profonds** : `kwatt://salon/CODE` → `/salon/CODE`, `kwatt://ligue/CODE` → `/ligue/CODE` (le code d’invitation sert d’identifiant), `kwatt://ami/CODE` → `/ami/CODE`, `https://<domaine>/s/CODE` → `/salon/CODE`. Les codes sont normalisés (`m4t-k9q` → `M4TK9Q`) par `app/+native-intent.tsx` (`src/navigation/deepLinks.ts`).');
  lines.push('- **Accès** : la colonne reprend le Sommaire et la planche « Réf · Matrice » ; le serveur refait toutes les vérifications.');
  lines.push('');
  lines.push('| Écran | Clé | Fichier de route | URL | Planche(s) | Accès | Équipe | Remarque |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of sorted) {
    const screens = r.screens.length > 0 ? r.screens.join(', ') : '—';
    const planches = r.planches.length > 0 ? r.planches.map((p) => `${p}`).join(', ') : '—';
    lines.push(
      `| ${screens} | \`${r.key}\` | \`${r.file}\` | \`${r.pattern}\` | ${planches} | ${ACCESS_LABELS[r.access]} | ${TEAM_LABELS[r.owner]} | ${cell(r.note ?? '')} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
