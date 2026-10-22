import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Configuration Expo de Kwatt.
 *
 * Variables lues à la construction (jamais de secret ici : tout finit dans l'appli) :
 * - EXPO_PUBLIC_API_URL : adresse de l'API (ex. https://api.kwatt.example)
 * - EXPO_PUBLIC_WS_URL  : adresse du temps réel (par défaut : API_URL + /v1/ws, en ws:// ou wss://)
 * - EAS_PROJECT_ID      : identifiant du projet sur expo.dev (eas init l'affiche)
 * - KWATT_WEB_DOMAIN    : domaine des liens https://<domaine>/s/CODE (facultatif)
 */

const NIGHT_BG = '#0F1230'; // @kwatt/design brand.nuit (app.config ne peut pas importer le paquet TS)

const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
const wsUrl = process.env.EXPO_PUBLIC_WS_URL ?? `${apiUrl.replace(/^http/, 'ws')}/v1/ws`;
const projectId = process.env.EAS_PROJECT_ID;
const webDomain = process.env.KWATT_WEB_DOMAIN;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Kwatt',
  slug: 'kwatt',
  scheme: 'kwatt',
  version: '1.0.0',
  // Portrait sur téléphone, libre sur tablette : le verrou du téléphone est posé au démarrage
  // (src/app/orientation.ts) ; ici on laisse toutes les orientations possibles.
  orientation: 'default',
  icon: './assets/images/icon.png',
  // Le thème (Nuit, Plein soleil, Automatique) est géré par l'appli ; « automatic » permet
  // de lire le mode clair/sombre du système pour le réglage Automatique.
  userInterfaceStyle: 'automatic',
  backgroundColor: NIGHT_BG,
  runtimeVersion: { policy: 'appVersion' },
  ...(projectId ? { updates: { url: `https://u.expo.dev/${projectId}` } } : {}),
  ios: {
    bundleIdentifier: 'com.kwatt.app',
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      UISupportedInterfaceOrientations: ['UIInterfaceOrientationPortrait'],
      'UISupportedInterfaceOrientations~ipad': [
        'UIInterfaceOrientationPortrait',
        'UIInterfaceOrientationPortraitUpsideDown',
        'UIInterfaceOrientationLandscapeLeft',
        'UIInterfaceOrientationLandscapeRight',
      ],
      CFBundleAllowMixedLocalizations: true,
    },
    ...(webDomain ? { associatedDomains: [`applinks:${webDomain}`] } : {}),
  },
  android: {
    package: 'com.kwatt.app',
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundImage: './assets/images/adaptive-icon-background.png',
      monochromeImage: './assets/images/adaptive-icon-monochrome.png',
      backgroundColor: NIGHT_BG,
    },
    predictiveBackGestureEnabled: false,
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
    ...(webDomain
      ? {
          intentFilters: [
            {
              action: 'VIEW',
              autoVerify: true,
              data: [{ scheme: 'https', host: webDomain, pathPrefix: '/s/' }],
              category: ['BROWSABLE', 'DEFAULT'],
            },
          ],
        }
      : {}),
  },
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/images/favicon.png',
    name: 'Kwatt',
    backgroundColor: NIGHT_BG,
    themeColor: NIGHT_BG,
  },
  // Textes des autorisations système, dans les deux langues de l'appli.
  locales: {
    fr: './store-locales/fr.json',
    en: './store-locales/en.json',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: NIGHT_BG,
        image: './assets/images/splash-icon.png',
        imageWidth: 180,
        resizeMode: 'contain',
      },
    ],
    'expo-font',
    'expo-localization',
    'expo-secure-store',
    ['expo-audio', { microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: false }],
    [
      'expo-image-picker',
      {
        photosPermission: 'Kwatt utilise tes photos pour ta photo de profil.',
        cameraPermission: 'Kwatt utilise l’appareil photo pour ta photo de profil.',
        microphonePermission: false,
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/images/notification-icon.png',
        color: '#1D2B6E',
      },
    ],
    'expo-screen-orientation',
  ],
  experiments: {
    tsconfigPaths: true,
  },
  extra: {
    apiUrl,
    wsUrl,
    ...(webDomain ? { webDomain } : {}),
    ...(projectId ? { eas: { projectId } } : {}),
  },
});
