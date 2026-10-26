# Calibration des difficultés du Ludo

Mesure du 2026-10-26, régénérée par `pnpm --filter @kwatt/ludo-ai-service calibrate` (fichier écrit par le script, à ne pas retoucher à la main).

## Méthode

- Le **joueur de référence** est l'agent « Ton niveau » (`ton_niveau@1`) : par définition, un joueur de ton niveau gagne une partie sur deux contre lui. Il joue en tête-à-tête contre chaque difficulté.
- Places tournées à chaque donne, même suite de lancers pour les deux rotations (nombres aléatoires communs), graine 11.
- 120 donnes (240 parties) par difficulté ; Fon : 120 donnes, plafonné à 15000 nœuds d'expectimax par coup (au temps, 400 ms, il finit la profondeur 3 dans la grande majorité des coups ; sinon il garde la profondeur 2).
- p₂ = part de victoires du joueur ; intervalle de Wilson à 95 %. La cote d'un pari vaut 0,9 ÷ p (SPEC §7).
- À n joueurs (1 contre n − 1 machines du même niveau), `playerWinProbability` passe par un modèle de Luce : pₙ = s ÷ (s + (n − 1)·m) avec p₂ = s ÷ (s + m).

## Résultats (tête-à-tête)

| Variante | Difficulté | p₂ du joueur | IC 95 % | Parties | Cote 2 joueurs | p à 4 joueurs (Luce) | Durée |
|---|---|---|---|---|---|---|---|
| classique | facile | 90.4 % | 86.0 % – 93.5 % | 240 | 1.00 | 75.9 % | 14 s |
| classique | moyen | 74.6 % | 68.7 % – 79.7 % | 240 | 1.21 | 49.4 % | 14 s |
| classique | coriace | 54.2 % | 47.9 % – 60.4 % | 240 | 1.66 | 28.3 % | 20 s |
| classique | fon | 52.1 % | 45.8 % – 58.3 % | 240 | 1.73 | 26.6 % | 301 s |
| rapide | facile | 75.4 % | 69.6 % – 80.4 % | 240 | 1.19 | 50.6 % | 3 s |
| rapide | moyen | 67.9 % | 61.8 % – 73.5 % | 240 | 1.33 | 41.4 % | 3 s |
| rapide | coriace | 48.3 % | 42.1 % – 54.6 % | 240 | 1.86 | 23.8 % | 4 s |
| rapide | fon | 47.1 % | 40.9 % – 53.4 % | 240 | 1.91 | 22.9 % | 33 s |
| six | facile | 97.5 % | 94.7 % – 98.9 % | 240 | 0.95 | 86.4 % | 26 s |
| six | moyen | 89.6 % | 85.1 % – 92.8 % | 240 | 1.00 | 74.1 % | 30 s |
| six | coriace | 61.7 % | 55.4 % – 67.6 % | 240 | 1.46 | 34.9 % | 38 s |
| six | fon | 45.0 % | 38.8 % – 51.3 % | 240 | 2.00 | 21.4 % | 619 s |

« Ton niveau » n'est pas mesuré : il vaut 50 % par construction.

## Contrôle à 4 joueurs

Classique, 1 joueur de référence contre 3 Coriace : 28.7 % de victoires (IC 22.3 % – 36.2 %, 160 parties, place moyenne 2.41) ; le modèle de Luce prévoit 28.3 %.

La prévision est dans l'intervalle de confiance : le modèle est retenu.

## Constats

- Ordre des difficultés à surveiller :
  - classique : fon (52.1 %) pas plus dur que ton_niveau (50.0 %), dans la marge d'erreur
  - rapide : ton_niveau (50.0 %) pas plus dur que coriace (48.3 %), dans la marge d'erreur
- Conséquence : la cote suit la mesure (une difficulté pas plus dure ne paie pas plus) ; c'est l'agent qu'il faut renforcer (`levels.ts`), pas la table.

## Lecture

- Les difficultés sont bien ordonnées si p₂ décroît de Facile à Fon. La machine ne touche jamais au dé : seule la qualité des décisions change.
- Au Ludo, le hasard pèse lourd : même Fon perd souvent contre un joueur moyen. Les écarts restent plus faibles qu'aux Dames, et les cotes en tiennent compte.
- À refaire après tout changement d'agent (`levels.ts`) ; le serveur lit la table de `calibration.ts`.
