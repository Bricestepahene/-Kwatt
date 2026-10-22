/**
 * Jeton push Expo, enregistré à la connexion (POST /v1/notifications/push-token).
 * Jamais bloquant : sur le web, dans Expo Go sur Android (pas de push distant depuis le
 * SDK 53), sans identifiant de projet EAS ou sans autorisation, on n'enregistre rien.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { accountsApi } from './api';

/** Canaux Android attendus par le serveur (fondation serveur) : turn, invites, league, default. */
const ANDROID_CHANNELS = ['turn', 'invites', 'league', 'default'] as const;

let lastSent: string | null = null;

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  for (const id of ANDROID_CHANNELS) {
    await Notifications.setNotificationChannelAsync(id, {
      name: id,
      importance: id === 'turn' || id === 'invites' ? Notifications.AndroidImportance.HIGH : Notifications.AndroidImportance.DEFAULT,
    });
  }
}

/** Demande l'autorisation si besoin, puis envoie le jeton au serveur (une fois par jeton). */
export async function registerPushToken(): Promise<void> {
  try {
    if (Platform.OS === 'web') return;
    if (Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return;
    const id = projectId();
    if (!id) return;
    await ensureAndroidChannels();
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    if (!token || token === lastSent) return;
    await accountsApi.registerPushToken(token);
    lastSent = token;
  } catch {
    // Pas de push sur cet appareil : l'appli marche sans (liste des notifications, temps réel).
  }
}

/** À la déconnexion, le serveur coupe déjà le push de l'appareil : on oublie le jeton envoyé. */
export function forgetPushToken(): void {
  lastSent = null;
}
