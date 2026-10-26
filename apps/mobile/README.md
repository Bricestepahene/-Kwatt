# @kwatt/mobile · l’appli Kwatt

Appli Expo (SDK 58, `expo-router`, React Native 0.88, TypeScript strict), Android, iOS et web (pour la vérification). Aucun module natif hors Expo SDK : elle tourne dans **Expo Go**.

## Lancer

```sh
pnpm install                                  # à la racine du dépôt
cp apps/mobile/.env.example apps/mobile/.env  # adresse de l'API (IP de l'ordinateur pour un téléphone)
pnpm --filter @kwatt/mobile start:go          # Expo Go (QR code)
pnpm --filter @kwatt/mobile start             # build de développement (expo-dev-client)
pnpm --filter @kwatt/mobile web               # navigateur
```

Les écrans demandent un serveur (`pnpm --filter @kwatt/server dev`, adresse dans `.env`). En développement, `/kit` montre tout le kit de composants.

## Vérifier

| Commande (dans `apps/mobile`) | Ce qu’elle fait |
|---|---|
| `pnpm typecheck` (racine) | `tsc -b`, l’appli comprise |
| `pnpm test` (racine) | vitest : langues (parité fr/en de tous les catalogues), formats, client REST et renouvellement, temps réel, session, file hors ligne, préférences, sons, routes, droits, liens profonds |
| `npx expo export --platform web` | export web (doit réussir) |
| `pnpm smoke:web` | parcours sur l’export web : garde de session, liens, onglets, langue et thème instantanés |
| `pnpm screenshots` | captures de chaque route en 390 × 844, fr/en, Nuit/Plein soleil (`screenshots/`, non versionné) |
| `pnpm routes:doc` | réécrit `ROUTES.md` depuis `src/navigation/routes.ts` |
| `pnpm assets:icons` · `pnpm assets:sounds` | régénèrent l’icône, l’écran de démarrage et les sons (déterministes) |

Les scripts Playwright utilisent le Chromium installé (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` par défaut) et le port 8102.

## Construire (EAS)

`app.config.ts` lit `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WS_URL`, `EAS_PROJECT_ID` et `KWATT_WEB_DOMAIN` (liens `https://<domaine>/s/CODE`). L'appli lit d'abord `EXPO_PUBLIC_API_URL` et `EXPO_PUBLIC_WS_URL` (toujours à jour dans le paquet), puis `extra` : le manifeste qui porte `extra` peut rester en cache d'un export à l'autre, donc après un changement de `KWATT_WEB_DOMAIN` ou `EAS_PROJECT_ID`, exporter avec `--clear`. Profils de `eas.json` : `development` (client de développement, APK), `preview` (APK Android + iOS interne), `production` (AAB, numéro de version géré par EAS).

```sh
eas init                      # donne EAS_PROJECT_ID
eas build --profile preview   # fichiers d'installation à partager
```

## Où mettre quoi

```
app/                    une route = un fichier (voir ROUTES.md : écran → fichier → planche → équipe)
src/ui/                 kit de composants (import { Screen, Header, Button… } from '@/ui')
src/ui/fabrics/         tissus ndop, toghu, kaba, obom en SVG (fond, bande, cadre d'avatar)
src/theme/              Nuit / Plein soleil / Automatique, useTheme(), polices, styles de texte
src/i18n/               i18next ; catalogues src/i18n/locales/{fr,en}/<espace>.json (déclarés dans resources.ts)
src/api/                client REST (jetons, renouvellement), client WebSocket, QueryClient, types minimaux
src/session/            session (zustand + expo-secure-store), identifiant d'installation
src/offline/            réseau (NetInfo) et file hors ligne persistante (registerOfflineSender)
src/preferences/        préférences de l'appareil et réglages prêts à poser (QuickSettings)
src/sound/              sons du plateau (expo-audio) et vibrations (expo-haptics)
src/navigation/         table des routes, garde de session, liens profonds, barre du bas
src/features/<nom>/     logique de chaque fonctionnalité (équipes suivantes)
```

Règles : couleurs seulement par `useTheme().colors` (tirées de `@kwatt/design`), textes seulement par les catalogues (fr **et** en), zones tactiles ≥ 48 px, `accessibilityLabel` sur chaque bouton-icône.
