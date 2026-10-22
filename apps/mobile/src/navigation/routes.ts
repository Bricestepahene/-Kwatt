/**
 * Table de toutes les routes de l'appli : source unique pour la garde de session,
 * les écrans provisoires, ROUTES.md (vérifié par test) et les captures d'écran.
 * Module pur, sans React Native.
 *
 * Pour remplacer un écran provisoire : réécrire le fichier `file` (le composant par
 * défaut exporté), sans changer son chemin ni son niveau d'accès sans mettre ce
 * tableau à jour.
 */

/**
 * Qui peut ouvrir l'écran (planche « Réf · Matrice » et colonne d'accès du Sommaire) :
 * - `public`    : tout le monde, même sans session ;
 * - `signedOut` : sans session ou invité ; un profil connecté est renvoyé à l'accueil ;
 * - `guest`     : une session est nécessaire, invité ou profil (« Tous » / « Invité ») ;
 * - `member`    : profil (pas d'invité) ;
 * - `adult`     : profil de 18 ans et plus (« 18 ans + »).
 */
export type AccessLevel = 'public' | 'signedOut' | 'guest' | 'member' | 'adult';

/** Équipes propriétaires (SPEC §11). */
export type Team =
  | 'fondation-appli'
  | 'comptes'
  | 'profil'
  | 'dames'
  | 'ludo'
  | 'parties-en-ligne'
  | 'ligues'
  | 'communaute';

/** Espace de jeu : donne la bande de tissu en haut de l'écran (bois, kaba, ndop). */
export type Space = 'hub' | 'dames' | 'ludo';

export interface RouteSpec {
  /** Identifiant stable, aussi clé du catalogue `screens`. */
  readonly key: string;
  /** Numéros d'écran du Sommaire (vide pour une route technique). */
  readonly screens: readonly string[];
  /** Planches de la maquette (docs/maquette/<planche>.dc.html). */
  readonly planches: readonly string[];
  /** Fichier de route, relatif à apps/mobile. */
  readonly file: string;
  /** Motif d'URL, tel que le donne expo-router (segments dynamiques entre crochets). */
  readonly pattern: string;
  readonly access: AccessLevel;
  readonly owner: Team;
  readonly space: Space;
  /** Barre du bas visible (écrans des onglets). */
  readonly tab?: 'home' | 'play' | 'leagues' | 'cards' | 'profile';
  /**
   * Écrans atteignables depuis celui-ci (liens de la planche), pour l'écran provisoire.
   * Des clés de route (vérifiées par test : le type ne peut pas se référencer lui-même).
   */
  readonly links?: readonly string[];
  /** Remarque pour ROUTES.md. */
  readonly note?: string;
}

const defineRoutes = <const T extends readonly RouteSpec[]>(routes: T): T => routes;

export const ROUTES = defineRoutes([
  // --- Entrée dans l'appli · groupe (auth) -----------------------------------
  {
    key: 'bienvenue', screens: ['01'], planches: ['Bienvenue'], file: 'app/(auth)/bienvenue.tsx',
    pattern: '/bienvenue', access: 'signedOut', owner: 'comptes', space: 'hub',
    links: ['rejoindre', 'inscription', 'connexion'],
    note: 'Page d’arrivée sans session et « accueil » des invités. Prévoir le choix FR/EN ici (un invité n’a pas accès aux Paramètres).',
  },
  {
    key: 'rejoindre', screens: ['02'], planches: ['RejoindreCode'], file: 'app/(auth)/rejoindre.tsx',
    pattern: '/rejoindre', access: 'public', owner: 'comptes', space: 'hub', links: ['salon'],
    note: 'Paramètre facultatif `?code=ABCDEF` (lien kwatt://salon/CODE ouvert sans session). Crée la session invitée.',
  },
  {
    key: 'inscription', screens: ['03'], planches: ['Inscription'], file: 'app/(auth)/inscription.tsx',
    pattern: '/inscription', access: 'signedOut', owner: 'comptes', space: 'hub', links: ['age', 'bienvenue'],
    note: 'Un invité qui s’inscrit garde ses parties (compte converti).',
  },
  {
    key: 'verifierEmail', screens: ['03'], planches: ['Inscription'], file: 'app/(auth)/verifier-email.tsx',
    pattern: '/verifier-email', access: 'member', owner: 'comptes', space: 'hub', links: ['premierLancement'],
    note: 'Étape « code à 6 chiffres » de l’inscription (CodeInput).',
  },
  {
    key: 'age', screens: ['04'], planches: ['Age'], file: 'app/(auth)/age.tsx',
    pattern: '/age', access: 'signedOut', owner: 'comptes', space: 'hub', links: ['inscription'],
  },
  {
    key: 'premierLancement', screens: ['05'], planches: ['Tutoriel'], file: 'app/(auth)/premier-lancement.tsx',
    pattern: '/premier-lancement', access: 'member', owner: 'comptes', space: 'hub',
    links: ['accueil', 'machine', 'modeLudo'],
  },
  {
    key: 'connexion', screens: ['06'], planches: ['Connexion'], file: 'app/(auth)/connexion.tsx',
    pattern: '/connexion', access: 'signedOut', owner: 'comptes', space: 'hub', links: ['motDePasseOublie', 'accueil'],
  },
  {
    key: 'motDePasseOublie', screens: ['06'], planches: ['Connexion'], file: 'app/(auth)/mot-de-passe-oublie.tsx',
    pattern: '/mot-de-passe-oublie', access: 'public', owner: 'comptes', space: 'hub', links: ['connexion'],
    note: 'Feuille « mot de passe oublié » (contact → code → nouveau mot de passe), présentée en feuille.',
  },

  // --- Onglets · groupe (tabs) -------------------------------------------------
  {
    key: 'accueil', screens: ['07'], planches: ['Accueil'], file: 'app/(tabs)/index.tsx',
    pattern: '/', access: 'member', owner: 'communaute', space: 'hub', tab: 'home',
    links: ['notifications', 'profil', 'modeDames', 'modeLudo', 'raisonnement', 'salon'],
  },
  {
    key: 'jouer', screens: [], planches: [], file: 'app/(tabs)/jouer/index.tsx',
    pattern: '/jouer', access: 'member', owner: 'fondation-appli', space: 'hub', tab: 'play',
    note: 'Rouvre le dernier espace utilisé (Dames par défaut) : redirection, pas d’écran.',
  },
  {
    key: 'modeDames', screens: ['14'], planches: ['ModeDames'], file: 'app/(tabs)/jouer/dames.tsx',
    pattern: '/jouer/dames', access: 'member', owner: 'dames', space: 'dames', tab: 'play',
    links: ['machine', 'creerSalon', 'mise', 'ligues', 'probleme', 'regles', 'partieDames', 'modeLudo', 'raisonnement'],
  },
  {
    key: 'modeLudo', screens: ['20'], planches: ['ModeLudo'], file: 'app/(tabs)/jouer/ludo.tsx',
    pattern: '/jouer/ludo', access: 'member', owner: 'ludo', space: 'ludo', tab: 'play',
    links: ['ludoVariantes', 'creerSalon', 'regarder', 'regles', 'partieLudo', 'modeDames', 'raisonnement'],
  },
  {
    key: 'ligues', screens: ['27'], planches: ['Ligues'], file: 'app/(tabs)/ligues.tsx',
    pattern: '/ligues', access: 'member', owner: 'ligues', space: 'hub', tab: 'leagues',
    links: ['creerLigue', 'championnat', 'liguePublique'],
  },
  {
    key: 'cartes', screens: ['39'], planches: ['Cartes'], file: 'app/(tabs)/cartes.tsx',
    pattern: '/cartes', access: 'member', owner: 'communaute', space: 'hub', tab: 'cards',
  },
  {
    key: 'profil', screens: ['09'], planches: ['Profil'], file: 'app/(tabs)/profil.tsx',
    pattern: '/profil', access: 'member', owner: 'profil', space: 'hub', tab: 'profile',
    links: ['amis', 'parametres', 'avatarStudio', 'quartiers', 'recompenses', 'echelons'],
  },

  // --- Hub et profil -------------------------------------------------------------
  {
    key: 'notifications', screens: ['08'], planches: ['Notifications'], file: 'app/notifications.tsx',
    pattern: '/notifications', access: 'member', owner: 'communaute', space: 'hub',
    links: ['parametres', 'partieLudo', 'mise', 'exclusion'],
  },
  {
    key: 'avatarStudio', screens: ['10'], planches: ['AvatarStudio'], file: 'app/avatar/index.tsx',
    pattern: '/avatar', access: 'member', owner: 'profil', space: 'hub', links: ['avatarBoutique'],
  },
  {
    key: 'avatarBoutique', screens: ['11'], planches: ['AvatarBoutique'], file: 'app/avatar/boutique.tsx',
    pattern: '/avatar/boutique', access: 'member', owner: 'profil', space: 'hub',
  },
  {
    key: 'amis', screens: ['12'], planches: ['Amis'], file: 'app/amis.tsx',
    pattern: '/amis', access: 'member', owner: 'communaute', space: 'hub', links: ['salon', 'mise', 'regarder'],
  },
  {
    key: 'ami', screens: ['12'], planches: ['Amis'], file: 'app/ami/[code].tsx',
    pattern: '/ami/[code]', access: 'member', owner: 'communaute', space: 'hub', links: ['amis'],
    note: 'Lien d’invitation kwatt://ami/CODE : propose d’ajouter le joueur en ami.',
  },
  {
    key: 'parametres', screens: ['13'], planches: ['Parametres'], file: 'app/parametres/index.tsx',
    pattern: '/parametres', access: 'member', owner: 'comptes', space: 'hub',
    links: ['affichage', 'motDePasseOublie', 'bienvenue'],
    note: 'Les réglages vivent dans src/preferences (store persistant) ; la langue se change avec setAppLanguage() (src/i18n).',
  },
  {
    key: 'affichage', screens: ['17'], planches: ['PleinSoleil'], file: 'app/parametres/affichage.tsx',
    pattern: '/parametres/affichage', access: 'public', owner: 'dames', space: 'dames',
    note: 'Réglage Nuit / Plein soleil / Automatique (src/theme) ; aussi accessible depuis le menu d’une partie.',
  },

  // --- Jouer · Dames ---------------------------------------------------------------
  {
    key: 'machine', screens: ['15'], planches: ['DefiMachine'], file: 'app/dames/machine.tsx',
    pattern: '/dames/machine', access: 'member', owner: 'dames', space: 'dames', links: ['partieDames'],
  },
  {
    key: 'partieDames', screens: ['16', '16b', '43'], planches: ['PartieDames', 'PartieDames8', 'TabletteDames'],
    file: 'app/dames/partie/[id].tsx', pattern: '/dames/partie/[id]', access: 'guest', owner: 'dames', space: 'dames',
    links: ['resultat', 'affichage', 'signaler', 'regles'],
    note: '10×10 (16), 8×8 (16b) et mise en page tablette (43) : même route, la variante vient de la partie. Pas de barre du bas.',
  },
  {
    key: 'resultat', screens: ['18'], planches: ['Resultat'], file: 'app/partie/[id]/resultat.tsx',
    pattern: '/partie/[id]/resultat', access: 'guest', owner: 'dames', space: 'hub',
    links: ['revoir', 'salon', 'mise', 'accueil'],
    note: 'Fin de partie commune aux Dames et au Ludo : revanche (défi) ou joueur suivant (salon).',
  },
  {
    key: 'revoir', screens: ['19'], planches: ['Revoir'], file: 'app/partie/[id]/revoir.tsx',
    pattern: '/partie/[id]/revoir', access: 'member', owner: 'dames', space: 'dames', links: ['resultat'],
  },
  {
    key: 'probleme', screens: ['19b'], planches: ['ProblemeDuJour'], file: 'app/dames/probleme-du-jour.tsx',
    pattern: '/dames/probleme-du-jour', access: 'member', owner: 'dames', space: 'dames',
  },

  // --- Jouer · Ludo ------------------------------------------------------------------
  {
    key: 'ludoVariantes', screens: ['20b'], planches: ['LudoVariantes'], file: 'app/ludo/variantes.tsx',
    pattern: '/ludo/variantes', access: 'member', owner: 'ludo', space: 'ludo',
  },
  {
    key: 'partieLudo', screens: ['21', '21b', '21c'], planches: ['PartieLudo', 'PartieLudo6', 'LancerCauris'],
    file: 'app/ludo/partie/[id].tsx', pattern: '/ludo/partie/[id]', access: 'guest', owner: 'ludo', space: 'ludo',
    links: ['resultat', 'deHonnete', 'salon', 'regles'],
    note: 'Croix (21), étoile à 6 (21b) et lancer de cauris du Pachisi (21c) : même route. Pas de barre du bas.',
  },
  {
    key: 'deHonnete', screens: ['22'], planches: ['DeHonnete'], file: 'app/partie/[id]/de.tsx',
    pattern: '/partie/[id]/de', access: 'guest', owner: 'parties-en-ligne', space: 'ludo', links: ['resultat'],
  },
  {
    key: 'regles', screens: ['23'], planches: ['Regles'], file: 'app/regles/[jeu].tsx',
    pattern: '/regles/[jeu]', access: 'public', owner: 'ludo', space: 'hub', links: ['machine', 'modeLudo'],
    note: '`jeu` : dames, dames8 ou ludo.',
  },

  // --- Salons et défis -------------------------------------------------------------------
  {
    key: 'creerSalon', screens: ['24'], planches: ['CreerSalon'], file: 'app/salon/nouveau.tsx',
    pattern: '/salon/nouveau', access: 'member', owner: 'parties-en-ligne', space: 'hub', links: ['salon'],
  },
  {
    key: 'salon', screens: ['25'], planches: ['Salon'], file: 'app/salon/[code].tsx',
    pattern: '/salon/[code]', access: 'guest', owner: 'parties-en-ligne', space: 'hub',
    links: ['partieLudo', 'partieDames', 'deHonnete'],
    note: 'Lien kwatt://salon/CODE ; sans session, renvoi vers 02 avec le code.',
  },
  {
    key: 'mise', screens: ['26'], planches: ['Mise'], file: 'app/defi/[id].tsx',
    pattern: '/defi/[id]', access: 'adult', owner: 'parties-en-ligne', space: 'dames', links: ['partieDames'],
  },

  // --- Ligues ------------------------------------------------------------------------------
  {
    key: 'creerLigue', screens: ['28'], planches: ['CreerLigue'], file: 'app/ligue/nouvelle.tsx',
    pattern: '/ligue/nouvelle', access: 'member', owner: 'ligues', space: 'hub',
    links: ['reglesCompetition', 'creerLiguePublique'],
  },
  {
    key: 'reglesCompetition', screens: ['28b'], planches: ['ReglesCompetition'], file: 'app/ligue/regles.tsx',
    pattern: '/ligue/regles', access: 'member', owner: 'ligues', space: 'hub',
  },
  {
    key: 'championnat', screens: ['29'], planches: ['Championnat'], file: 'app/ligue/[id]/index.tsx',
    pattern: '/ligue/[id]', access: 'guest', owner: 'ligues', space: 'hub',
    links: ['coupe', 'matchDuJour', 'exclusion', 'validerLigue'],
    note: 'Lien kwatt://ligue/CODE (le code d’invitation sert d’identifiant). Une coupe renvoie vers 30.',
  },
  {
    key: 'coupe', screens: ['30'], planches: ['Coupe'], file: 'app/ligue/[id]/coupe.tsx',
    pattern: '/ligue/[id]/coupe', access: 'guest', owner: 'ligues', space: 'hub', links: ['choixPlanche'],
  },
  {
    key: 'creerLiguePublique', screens: ['31'], planches: ['CreerLiguePublique'], file: 'app/ligue-publique/nouvelle.tsx',
    pattern: '/ligue-publique/nouvelle', access: 'adult', owner: 'ligues', space: 'hub', links: ['validerLigue'],
  },
  {
    key: 'liguePublique', screens: ['32'], planches: ['LiguePublique'], file: 'app/ligue-publique/[id].tsx',
    pattern: '/ligue-publique/[id]', access: 'adult', owner: 'ligues', space: 'hub', links: ['matchDuJour'],
  },
  {
    key: 'validerLigue', screens: ['33'], planches: ['ValiderLigue'], file: 'app/ligue/[id]/valider.tsx',
    pattern: '/ligue/[id]/valider', access: 'member', owner: 'ligues', space: 'hub',
    note: 'Réservé au créateur de la ligue : vérifié par l’écran (le serveur fait foi).',
  },
  {
    key: 'matchDuJour', screens: ['34'], planches: ['MatchDuJour'], file: 'app/ligue/[id]/match/[matchId]/index.tsx',
    pattern: '/ligue/[id]/match/[matchId]', access: 'member', owner: 'ligues', space: 'hub',
    links: ['choixPlanche', 'partieDames'],
  },
  {
    key: 'choixPlanche', screens: ['34b'], planches: ['ChoixPlanche'], file: 'app/ligue/[id]/match/[matchId]/planche.tsx',
    pattern: '/ligue/[id]/match/[matchId]/planche', access: 'member', owner: 'ligues', space: 'hub',
  },
  {
    key: 'exclusion', screens: ['35'], planches: ['Exclusion'], file: 'app/ligue/[id]/exclusion.tsx',
    pattern: '/ligue/[id]/exclusion', access: 'member', owner: 'ligues', space: 'hub',
  },

  // --- Communauté, progression, raisonnement ------------------------------------------------
  {
    key: 'quartiers', screens: ['36'], planches: ['Quartiers'], file: 'app/quartiers.tsx',
    pattern: '/quartiers', access: 'member', owner: 'communaute', space: 'hub', links: ['machine'],
  },
  {
    key: 'regarder', screens: ['37'], planches: ['KwattTV'], file: 'app/regarder/[id].tsx',
    pattern: '/regarder/[id]', access: 'guest', owner: 'parties-en-ligne', space: 'dames', links: ['salon'],
    note: '« Autour du damier » : regarder ne demande pas de profil (session invitée).',
  },
  {
    key: 'signaler', screens: ['38'], planches: ['Signaler'], file: 'app/signaler/[userId].tsx',
    pattern: '/signaler/[userId]', access: 'member', owner: 'communaute', space: 'hub',
  },
  {
    key: 'recompenses', screens: ['40'], planches: ['Recompenses'], file: 'app/recompenses.tsx',
    pattern: '/recompenses', access: 'member', owner: 'communaute', space: 'hub',
  },
  {
    key: 'echelons', screens: ['41'], planches: ['Echelons'], file: 'app/echelons.tsx',
    pattern: '/echelons', access: 'member', owner: 'communaute', space: 'hub',
  },
  {
    key: 'raisonnement', screens: ['42'], planches: ['Raisonnement'], file: 'app/raisonnement.tsx',
    pattern: '/raisonnement', access: 'member', owner: 'communaute', space: 'hub', links: ['accueil'],
  },

  // --- Technique -------------------------------------------------------------------------------
  {
    key: 'lienSalon', screens: [], planches: [], file: 'app/s/[code].tsx',
    pattern: '/s/[code]', access: 'public', owner: 'fondation-appli', space: 'hub',
    note: 'Lien de partage https://<domaine>/s/CODE : redirige vers /salon/CODE.',
  },
  {
    key: 'kit', screens: [], planches: ['Main'], file: 'app/kit.tsx',
    pattern: '/kit', access: 'public', owner: 'fondation-appli', space: 'hub',
    note: 'Catalogue du kit de composants (développement, captures) : visible en développement ou avec EXPO_PUBLIC_SHOW_KIT=1, sinon renvoie à l’accueil.',
  },
] as const);

export type RouteKey = (typeof ROUTES)[number]['key'];

export const ROUTES_BY_KEY: Readonly<Record<RouteKey, RouteSpec>> = Object.fromEntries(
  ROUTES.map((r) => [r.key, r]),
) as unknown as Record<RouteKey, RouteSpec>;

/** Valeurs d'exemple des segments dynamiques (écrans provisoires, captures). */
export const EXAMPLE_PARAMS: Readonly<Record<string, string>> = {
  code: 'M4TK9Q',
  id: 'demo',
  matchId: 'demo',
  userId: 'demo',
  jeu: 'dames',
};

/** Construit une URL à partir d'un motif : `/salon/[code]` + { code } → `/salon/M4TK9Q`. */
export function buildPath(pattern: string, params: Readonly<Record<string, string>> = {}): string {
  return pattern.replace(/\[([^\]]+)\]/g, (_, name: string) => {
    const value = params[name] ?? EXAMPLE_PARAMS[name];
    if (value === undefined) throw new Error(`Paramètre manquant « ${name} » pour ${pattern}`);
    return encodeURIComponent(value);
  });
}

/**
 * Motif de la route courante à partir des segments d'expo-router
 * (`useSegments()`) : les groupes « (auth) » sont retirés, « index » aussi.
 */
export function patternFromSegments(segments: readonly string[]): string {
  const parts = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')) && s !== 'index');
  return `/${parts.join('/')}`;
}

/** Route correspondant à un motif, ou `undefined` (page inconnue). */
export function routeForPattern(pattern: string): RouteSpec | undefined {
  return ROUTES.find((r) => r.pattern === pattern);
}
