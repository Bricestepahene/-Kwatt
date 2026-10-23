import Constants from 'expo-constants';

/**
 * Adresses du serveur, lues d'abord dans les variables EXPO_PUBLIC_, puis dans `extra` (app.config.ts).
 * Les variables EXPO_PUBLIC_ passent en premier : Metro les inscrit dans le paquet à chaque export,
 * alors que le manifeste qui porte `extra` peut rester en cache d'un export à l'autre (un export web
 * gardait ainsi http://localhost:8080 malgré EXPO_PUBLIC_API_URL).
 * Aucune valeur secrète ici : tout ce qui est dans l'appli est lisible par l'utilisateur.
 */
interface Extra {
  apiUrl?: string;
  wsUrl?: string;
  webDomain?: string;
}

const extra: Extra = (Constants.expoConfig?.extra as Extra | undefined) ?? {};

const apiUrl = (process.env.EXPO_PUBLIC_API_URL || extra.apiUrl || 'http://localhost:8080').replace(/\/+$/, '');

export const env = {
  apiUrl,
  wsUrl: process.env.EXPO_PUBLIC_WS_URL || (process.env.EXPO_PUBLIC_API_URL ? undefined : extra.wsUrl) || `${apiUrl.replace(/^http/, 'ws')}/v1/ws`,
  webDomain: extra.webDomain ?? null,
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
} as const;
