/**
 * Photo de profil (écran 10, « Ma photo ») : prendre ou choisir une image, la recadrer en
 * carré (au centre si l'appareil ne propose pas le recadrage), la réduire, puis l'envoyer en
 * multipart à POST /v1/me/photo. Le serveur la remet en 512×512 WebP et la fait vérifier.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { squareCrop } from './photoMath';

/** Côté maximal envoyé (le serveur réduit à 512 : on garde de la marge pour la netteté). */
const UPLOAD_SIDE = 1024;

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

export type PickResult = { kind: 'picked'; photo: PickedPhoto } | { kind: 'cancelled' } | { kind: 'denied' };

/** Ouvre l'appareil photo ou la galerie, puis recadre en carré. */
export async function pickSquarePhoto(source: 'camera' | 'library'): Promise<PickResult> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { kind: 'denied' };
  } else if (Platform.OS !== 'web') {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted && permission.accessPrivileges !== 'limited') return { kind: 'denied' };
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9, exif: false };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return { kind: 'cancelled' };

  // Recadrage carré au centre (le web et certains appareils ne proposent pas l'édition), puis réduction.
  const crop = squareCrop(asset.width, asset.height);
  const side = Math.min(crop.width, UPLOAD_SIDE);
  const context = ImageManipulator.ImageManipulator.manipulate(asset.uri);
  if (crop.width !== asset.width || crop.height !== asset.height) context.crop(crop);
  context.resize({ width: side, height: side });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.85, format: ImageManipulator.SaveFormat.JPEG });
  return { kind: 'picked', photo: { uri: saved.uri, width: saved.width, height: saved.height } };
}

/** Corps multipart de l'envoi (champ « photo », JPEG). */
export async function photoFormData(photo: PickedPhoto): Promise<FormData> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(photo.uri)).blob();
    form.append('photo', new Blob([blob], { type: 'image/jpeg' }), 'photo.jpg');
  } else {
    // React Native : un fichier local se décrit par { uri, name, type }.
    form.append('photo', { uri: photo.uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
  }
  return form;
}
