/**
 * Portrait sur téléphone, orientation libre sur tablette (app.config.ts laisse toutes
 * les orientations ; iOS limite déjà l'iPhone au portrait dans Info.plist).
 */
import * as Device from 'expo-device';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Dimensions, Platform } from 'react-native';
import { isTablet } from './device';

export function deviceIsTablet(): boolean {
  const { width, height } = Dimensions.get('screen');
  const type = Device.deviceType;
  const systemSaysTablet = type === Device.DeviceType.TABLET ? true : type === Device.DeviceType.PHONE ? false : null;
  return isTablet(systemSaysTablet, width, height);
}

/** Verrouille le portrait sur téléphone ; ne fait rien sur tablette et sur le web. */
export async function applyOrientationPolicy(): Promise<void> {
  if (Platform.OS === 'web' || deviceIsTablet()) return;
  await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
}
