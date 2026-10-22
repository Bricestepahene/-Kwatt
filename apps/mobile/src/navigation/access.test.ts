import { describe, expect, it } from 'vitest';
import { decideAccess, safeNext, type AccessSession } from './access';
import { ROUTES_BY_KEY, type RouteKey } from './routes';

const signedOut: AccessSession = { status: 'signedOut', isAdult: false };
const guest: AccessSession = { status: 'guest', isAdult: false };
const teen: AccessSession = { status: 'member', isAdult: false };
const adult: AccessSession = { status: 'member', isAdult: true };

function decide(key: RouteKey, session: AccessSession, pathname = '/x', params: Record<string, string> = {}, after: string | null = null) {
  return decideAccess(ROUTES_BY_KEY[key], session, pathname, params, after);
}

describe('garde de session · matrice des droits', () => {
  it('sans session : Bienvenue, en gardant où on allait', () => {
    expect(decide('accueil', signedOut, '/')).toEqual({ kind: 'redirect', to: '/bienvenue', reason: 'needs_session' });
    expect(decide('amis', signedOut, '/amis')).toEqual({ kind: 'redirect', to: '/bienvenue?next=%2Famis', reason: 'needs_session' });
    expect(decide('bienvenue', signedOut).kind).toBe('allow');
    expect(decide('connexion', signedOut).kind).toBe('allow');
    expect(decide('rejoindre', signedOut).kind).toBe('allow');
    expect(decide('regles', signedOut).kind).toBe('allow');
  });

  it('un lien de salon sans session passe par « Rejoindre avec un code »', () => {
    expect(decide('salon', signedOut, '/salon/M4TK9Q', { code: 'M4TK9Q' })).toEqual({
      kind: 'redirect',
      to: '/rejoindre?code=M4TK9Q',
      reason: 'needs_session',
    });
    expect(decide('salon', signedOut, '/salon/m4t-k9q', { code: 'm4t-k9q' })).toMatchObject({ to: '/rejoindre?code=M4TK9Q' });
  });

  it('un invité rejoint un salon, regarde, entre dans une ligue privée gratuite, joue', () => {
    for (const key of ['salon', 'regarder', 'championnat', 'coupe', 'partieDames', 'partieLudo', 'resultat', 'deHonnete'] as const) {
      expect(decide(key, guest).kind, key).toBe('allow');
    }
  });

  it('un invité ne crée rien et ne mise pas (profil requis)', () => {
    for (const key of ['creerSalon', 'creerLigue', 'mise', 'creerLiguePublique', 'avatarBoutique', 'accueil', 'profil'] as const) {
      const decision = decide(key, guest, `/${key}`);
      expect(decision.kind, key).toBe('redirect');
      if (decision.kind === 'redirect') {
        expect(decision.to.startsWith('/bienvenue'), key).toBe(true);
        expect(decision.reason, key).toBe('needs_member');
      }
    }
  });

  it('un invité garde l’accès aux écrans d’entrée (pour créer son profil)', () => {
    expect(decide('bienvenue', guest).kind).toBe('allow');
    expect(decide('inscription', guest).kind).toBe('allow');
  });

  it('mises et ligues publiques : 18 ans et plus', () => {
    expect(decide('mise', teen)).toEqual({ kind: 'redirect', to: '/', reason: 'needs_adult' });
    expect(decide('liguePublique', teen).kind).toBe('redirect');
    expect(decide('mise', adult).kind).toBe('allow');
    expect(decide('creerLiguePublique', adult).kind).toBe('allow');
  });

  it('un profil connecté quitte les écrans d’entrée, vers la suite déclarée', () => {
    expect(decide('connexion', adult)).toEqual({ kind: 'redirect', to: '/', reason: 'already_signed_in' });
    expect(decide('connexion', adult, '/connexion', { next: '/amis' })).toMatchObject({ to: '/amis' });
    expect(decide('inscription', adult, '/inscription', {}, '/verifier-email')).toMatchObject({ to: '/verifier-email' });
    expect(decide('connexion', adult, '/connexion', { next: 'https://pirate.example' })).toMatchObject({ to: '/' });
    // « Mot de passe oublié » reste ouvert (changer son mot de passe depuis Paramètres).
    expect(decide('motDePasseOublie', adult).kind).toBe('allow');
  });

  it('laisse expo-router gérer une page inconnue', () => {
    expect(decideAccess(undefined, signedOut, '/nulle-part')).toEqual({ kind: 'allow' });
  });
});

describe('retour après connexion', () => {
  it('n’accepte qu’un chemin interne', () => {
    expect(safeNext('/salon/M4TK9Q')).toBe('/salon/M4TK9Q');
    expect(safeNext('//pirate.example')).toBe('/');
    expect(safeNext('https://pirate.example')).toBe('/');
    expect(safeNext('/\\pirate')).toBe('/');
    expect(safeNext(undefined, '/jouer')).toBe('/jouer');
    expect(safeNext(['/a'])).toBe('/');
  });
});
