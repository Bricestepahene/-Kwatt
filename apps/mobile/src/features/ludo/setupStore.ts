/**
 * Variante courante de l'espace Ludo, gardée sur l'appareil (écran 20 « Classique ·
 * changer », écran 20b). Lecture tolérante (sanitizeSetup).
 */
import { useEffect } from 'react';
import { createStore, useStore } from 'zustand';
import { localStorage } from '../../storage/deviceStorage';
import { readJson, writeJson } from '../../storage/kv';
import { DEFAULT_SETUP, sanitizeSetup, type LudoSetup } from './setup';

export const LUDO_SETUP_KEY = 'kwatt.ludo.setup.v1';

interface SetupState {
  setup: LudoSetup;
  hydrated: boolean;
}

export const setupStore = createStore<SetupState>()(() => ({ setup: { ...DEFAULT_SETUP }, hydrated: false }));

let loading: Promise<void> | null = null;

export function hydrateLudoSetup(): Promise<void> {
  loading ??= readJson(localStorage, LUDO_SETUP_KEY).then((raw) => {
    setupStore.setState({ setup: sanitizeSetup(raw), hydrated: true });
  });
  return loading;
}

export function setLudoSetup(setup: LudoSetup): void {
  setupStore.setState({ setup, hydrated: true });
  void writeJson(localStorage, LUDO_SETUP_KEY, setup).catch(() => undefined);
}

export function useLudoSetup(): LudoSetup {
  useEffect(() => {
    void hydrateLudoSetup();
  }, []);
  return useStore(setupStore, (s) => s.setup);
}
