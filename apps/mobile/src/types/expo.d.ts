// Types globaux d'Expo (require.context, modules CSS, react-native-web).
// Le fichier expo-env.d.ts généré par la CLI n'est pas versionné : celui-ci le remplace pour `tsc -b`.
/// <reference types="expo/types" />

declare module '*.wav' {
  const asset: number;
  export default asset;
}

declare module '*.png' {
  const asset: number;
  export default asset;
}
