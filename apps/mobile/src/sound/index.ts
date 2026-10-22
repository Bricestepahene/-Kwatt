/**
 * Sons et vibrations du plateau, selon les préférences (son, volume, vibration).
 *
 *   playBoardFeedback('capture');   // tam-tam + vibration si activée
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { getPreferences } from '../preferences';
import { hapticFor, soundFor, type BoardEvent, type SoundId } from './plan';

export * from './plan';

const SOURCES: Record<SoundId, number> = {
  balafon: require('../../assets/sounds/balafon.wav') as number,
  tamtam: require('../../assets/sounds/tamtam.wav') as number,
  tamtamLight: require('../../assets/sounds/tamtam-leger.wav') as number,
  nkul: require('../../assets/sounds/nkul.wav') as number,
  mvet: require('../../assets/sounds/mvet.wav') as number,
};

const players = new Map<SoundId, AudioPlayer>();
let audioReady: Promise<void> | null = null;

function prepareAudio(): Promise<void> {
  audioReady ??= setAudioModeAsync({
    // Respecte le bouton silencieux de l'iPhone et se mêle à la musique du joueur.
    playsInSilentMode: false,
    interruptionMode: 'mixWithOthers',
    shouldPlayInBackground: false,
  }).catch(() => undefined);
  return audioReady;
}

function playerFor(id: SoundId): AudioPlayer | null {
  let player = players.get(id);
  if (!player) {
    try {
      player = createAudioPlayer(SOURCES[id]);
      players.set(id, player);
    } catch {
      return null;
    }
  }
  return player;
}

/** Charge les sons à l'avance (appelé au démarrage, sans attendre). */
export function preloadSounds(): void {
  void prepareAudio().then(() => {
    for (const id of Object.keys(SOURCES) as SoundId[]) playerFor(id);
  });
}

export function playSound(id: SoundId, volume = getPreferences().volume): void {
  void prepareAudio().then(async () => {
    const player = playerFor(id);
    if (!player) return;
    try {
      player.volume = Math.max(0, Math.min(1, volume));
      await player.seekTo(0);
      player.play();
    } catch {
      // Un son raté ne doit jamais gêner la partie.
    }
  });
}

export function vibrate(kind: 'capture' | 'error'): void {
  if (Platform.OS === 'web') return;
  const run =
    kind === 'error'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  void run.catch(() => undefined);
}

/** Son et vibration d'un événement du plateau, selon les préférences du joueur. */
export function playBoardFeedback(event: BoardEvent): void {
  const prefs = getPreferences();
  const sound = soundFor(event, prefs.soundPack);
  if (sound && prefs.volume > 0) playSound(sound, prefs.volume);
  const haptic = hapticFor(event, prefs);
  if (haptic) vibrate(haptic);
}
