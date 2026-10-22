/**
 * Stockages de l'appareil :
 * - `localStorage` : AsyncStorage (préférences, file hors ligne) ;
 * - `secureStorage` : trousseau / keystore via expo-secure-store (jetons, identifiant
 *   d'installation). Sur le web, où SecureStore n'existe pas, repli sur AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { KeyValueStore } from './kv';

export const localStorage: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

const nativeSecureStorage: KeyValueStore = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export const secureStorage: KeyValueStore = Platform.OS === 'web' ? localStorage : nativeSecureStorage;
