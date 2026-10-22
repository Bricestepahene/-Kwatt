import { describe, expect, it, vi } from 'vitest';
import { memoryStore, STORAGE_KEYS } from '../storage/kv';
import type { AuthResponse } from '../api/types';
import { createInstallIdProvider } from './installId';
import { accessSessionOf, createSessionStore, jwtExpiry, tokensFrom } from './session';

const NOW = 1_800_000_000_000;

const member: AuthResponse = {
  accessToken: 'acc-1',
  refreshToken: 'ref-1',
  expiresIn: 900,
  user: { id: 'u1', kind: 'member', pseudo: 'brice_237', ageBand: 'adult', emailVerified: true },
};

function jwt(payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.signature`;
}

describe('session', () => {
  it('démarre en chargement, puis sans session si rien n’est gardé', async () => {
    const store = createSessionStore(memoryStore(), () => NOW);
    expect(store.getState().status).toBe('loading');
    await store.getState().hydrate();
    expect(store.getState().status).toBe('signedOut');
  });

  it('ouvre une session de profil et la garde sur l’appareil', async () => {
    const storage = memoryStore();
    const store = createSessionStore(storage, () => NOW);
    await store.getState().signIn(member);
    expect(store.getState().status).toBe('member');
    expect(store.getState().data?.tokens.accessExpiresAt).toBe(NOW + 900_000);

    const again = createSessionStore(storage, () => NOW);
    await again.getState().hydrate();
    expect(again.getState().status).toBe('member');
    expect(again.getState().data?.user.pseudo).toBe('brice_237');
  });

  it('distingue invité et profil, et l’âge pour la garde', async () => {
    const store = createSessionStore(memoryStore(), () => NOW);
    await store.getState().signIn({ ...member, user: { ...member.user, kind: 'guest', ageBand: null } });
    expect(store.getState().status).toBe('guest');
    expect(accessSessionOf(store.getState())).toEqual({ status: 'guest', isAdult: false });
    await store.getState().updateUser({ kind: 'member', ageBand: 'teen' });
    expect(accessSessionOf(store.getState())).toEqual({ status: 'member', isAdult: false });
  });

  it('remplace les jetons après un renouvellement', async () => {
    let now = NOW;
    const store = createSessionStore(memoryStore(), () => now);
    await store.getState().signIn(member);
    now += 60_000;
    await store.getState().setTokens({ accessToken: 'acc-2', refreshToken: 'ref-2', expiresIn: 900 });
    expect(store.getState().data?.tokens).toEqual({ accessToken: 'acc-2', refreshToken: 'ref-2', accessExpiresAt: now + 900_000 });
  });

  it('se ferme et efface le stockage', async () => {
    const storage = memoryStore();
    const store = createSessionStore(storage, () => NOW);
    await store.getState().signIn(member);
    await store.getState().signOut();
    expect(store.getState().status).toBe('signedOut');
    expect(storage.dump()[STORAGE_KEYS.session]).toBeUndefined();
  });

  it('ignore une session abîmée', async () => {
    const store = createSessionStore(memoryStore({ [STORAGE_KEYS.session]: '{"tokens":{}}' }), () => NOW);
    await store.getState().hydrate();
    expect(store.getState().status).toBe('signedOut');
  });

  it('lit l’expiration dans le JWT si le serveur ne donne pas expiresIn', () => {
    const token = jwt({ sub: 'u1', exp: 1_900_000_000 });
    expect(jwtExpiry(token)).toBe(1_900_000_000_000);
    expect(jwtExpiry('opaque')).toBeNull();
    expect(tokensFrom({ accessToken: token, refreshToken: 'r' }, NOW).accessExpiresAt).toBe(1_900_000_000_000);
    expect(tokensFrom({ accessToken: 'opaque', refreshToken: 'r' }, NOW).accessExpiresAt).toBe(NOW + 900_000);
  });
});

describe('identifiant d’installation', () => {
  it('est tiré une seule fois puis réutilisé', async () => {
    const storage = memoryStore();
    const uuid = vi.fn(() => '0f8fad5b-d9cb-469f-a165-70867728950e');
    const get = createInstallIdProvider(storage, uuid);
    const [a, b] = await Promise.all([get(), get()]);
    expect(a).toBe('0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(b).toBe(a);
    expect(uuid).toHaveBeenCalledTimes(1);

    const later = createInstallIdProvider(storage, () => 'autre');
    expect(await later()).toBe(a);
  });

  it('remplace une valeur gardée invalide', async () => {
    const storage = memoryStore({ [STORAGE_KEYS.installId]: 'pas-un-uuid' });
    const get = createInstallIdProvider(storage, () => '7c9e6679-7425-40de-944b-e07fc1f90ae7');
    expect(await get()).toBe('7c9e6679-7425-40de-944b-e07fc1f90ae7');
  });
});
