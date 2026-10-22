import Constants from 'expo-constants';

/**
 * Adresses du serveur, lues dans `extra` (app.config.ts) puis dans les variables EXPO_PUBLIC_.
 * Aucune valeur secrète ici : tout ce qui est dans l'appli est lisible par l'utilisateur.
 */
interface Extra {
  apiUrl?: string;
  wsUrl?: string;
  webDomain?: string;
}

const extra: Extra = (Constants.expoConfig?.extra as Extra | undefined) ?? {};

const apiUrl = (extra.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/+$/, '');

export const env = {
  apiUrl,
  wsUrl: extra.wsUrl ?? process.env.EXPO_PUBLIC_WS_URL ?? `${apiUrl.replace(/^http/, 'ws')}/v1/ws`,
  webDomain: extra.webDomain ?? null,
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
} as const;
