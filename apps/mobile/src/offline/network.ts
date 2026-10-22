/**
 * Détection du réseau (@react-native-community/netinfo), partagée par toute l'appli :
 * bandeau « Pas de réseau », React Query (requêtes en pause hors ligne), temps réel,
 * file hors ligne.
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export interface NetworkState {
  /** `null` tant qu'on ne sait pas encore. */
  isOnline: boolean | null;
  /** Moment du dernier retour du réseau (pour le message « Le réseau est revenu »). */
  backOnlineAt: number | null;
}

export const networkStore = createStore<NetworkState>()(() => ({ isOnline: null, backOnlineAt: null }));

/** En ligne si connecté et Internet joignable (inconnu = on suppose oui, pour ne pas bloquer). */
export function isOnlineState(state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

let started = false;

/** Démarre l'écoute du réseau (une seule fois, au lancement de l'appli). */
export function startNetworkMonitoring(): () => void {
  if (started) return () => undefined;
  started = true;
  const unsubscribe = NetInfo.addEventListener((state) => {
    const online = isOnlineState(state);
    const previous = networkStore.getState().isOnline;
    networkStore.setState({
      isOnline: online,
      backOnlineAt: previous === false && online ? Date.now() : networkStore.getState().backOnlineAt,
    });
  });
  // React Query met ses requêtes en pause hors ligne et les relance au retour du réseau.
  onlineManager.setEventListener((setOnline) =>
    networkStore.subscribe((s) => {
      if (s.isOnline !== null) setOnline(s.isOnline);
    }),
  );
  return () => {
    started = false;
    unsubscribe();
  };
}

export function useNetwork<T>(selector: (state: NetworkState) => T): T {
  return useStore(networkStore, selector);
}

/** Vrai seulement quand on SAIT qu'il n'y a pas de réseau. */
export function useIsOffline(): boolean {
  return useNetwork((s) => s.isOnline === false);
}
