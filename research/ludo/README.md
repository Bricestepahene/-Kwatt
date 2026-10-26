# research/ludo · banc d'essai Python du Ludo

Hors production. La machine qui joue vraiment est `@kwatt/ludo-ai` (TypeScript), utilisée par le service `services/ludo-ai` et par l'appli hors connexion. Ce dossier sert à **mesurer** et à **entraîner** : un simulateur des règles en Python, des agents simples, un harnais de matchs et un auto-jeu qui exporte une évaluation linéaire lue par `linearEvaluator` (`packages/ludo-ai/src/learned.ts`).

Python 3.11 ou plus ; NumPy seulement pour l'entraînement (`train.py`).

## Contenu

| Fichier | Rôle |
|---|---|
| `kwatt_ludo/rules.py` | Simulateur des règles (Classique, Rapide, 6 joueurs), copie fidèle de `@kwatt/rules-ludo` pour ces variantes. |
| `kwatt_ludo/features.py` | Caractéristiques d'une position (`progress`, `base`, `home`, `corridor`, `exposed`), identiques à `LEARNED_FEATURES` côté TypeScript. |
| `kwatt_ludo/agents.py` | Agents : aléatoire, glouton, linéaire (poids appris). |
| `kwatt_ludo/evaluate.py` | Matchs entre agents : places tournées, mêmes lancers pour chaque rotation, intervalle de Wilson à 95 %. |
| `kwatt_ludo/train.py` | Auto-jeu et régression de Monte-Carlo (ridge), export au format `kwatt-ludo-eval`. |
| `fixtures/golden.jsonl.gz` | Parties d'or écrites par le moteur TypeScript : le simulateur doit les rejouer à l'identique. |
| `models/classique-linear.json` | Évaluation apprise pour le Classique à 2. |

## Commandes

```sh
cd research/ludo

# Tests : rejeu des parties d'or (mêmes coups légaux, mêmes positions, mêmes caractéristiques), outils.
python3 -m unittest -v

# Match entre agents (glouton, aléatoire, ou un modèle exporté).
python3 -m kwatt_ludo.evaluate --a glouton --b aléatoire --preset classique --players 2 --deals 100
python3 -m kwatt_ludo.evaluate --a models/classique-linear.json --b glouton

# Entraînement (quelques minutes) et export.
python3 -m kwatt_ludo.train --preset classique --players 2 --games 300 --generations 3 --out models/classique-linear.json
```

Régénérer les parties d'or après un changement des règles TypeScript (un test TypeScript vérifie que le fichier versionné est à jour) :

```sh
pnpm --filter @kwatt/ludo-ai-service golden
```

## Calibration des difficultés

La mesure qui sert aux cotes des paris se fait côté TypeScript, avec les vrais agents :

```sh
pnpm --filter @kwatt/ludo-ai-service calibrate -- --deals 120 --fon-deals 40 --workers 2
pnpm --filter @kwatt/ludo-ai-service bench -- --preset classique --players 4 --a level:fon:300 --b level:coriace --deals 50
```

Résultats et méthode : `packages/ludo-ai/CALIBRATION.md`.

## Limites

- Le simulateur Python ne couvre pas le Parchís ni le Pachisi (amicaux, sans cote) : les parties d'or ne portent que sur les variantes classées.
- L'évaluation linéaire est modeste (environ 60 % contre le glouton) ; elle sert de point de départ, pas de niveau de jeu.
