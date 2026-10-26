"""Entraîner une évaluation par auto-jeu et l'exporter pour ``@kwatt/ludo-ai``.

    python3 -m kwatt_ludo.train --preset classique --players 2 --games 300 --generations 3 \
        --out models/classique-linear.json

Méthode (volontairement simple, quelques minutes au plus) : régression de
Monte-Carlo. La génération 0 joue avec la politique gloutonne ; chaque
génération suivante joue avec le modèle de la précédente (un peu de hasard,
epsilon). Pour chaque position après un coup, on enregistre, pour chaque
siège, ses caractéristiques moins la moyenne des adversaires, et son résultat
final (+1 au gagnant, −1 au dernier, linéaire entre les deux). Une régression
ridge donne les poids. L'export est au format ``kwatt-ludo-eval`` (poids × 12 :
même échelle que ``utilities`` côté TypeScript), que ``linearEvaluator`` charge.

NumPy est requis ici (et seulement ici).
"""

from __future__ import annotations

import argparse
import json
import random
import time
from datetime import datetime, timezone

from .agents import GreedyAgent, LinearAgent, distinct
from .evaluate import run_match
from .features import FEATURES, relative_features
from .rules import apply_move, apply_roll, legal_moves, new_game, team_of

TERMINAL = 12.0


def self_play(agent, preset: str, players: int, games: int, seed: int, sample_every: int = 3):
    xs, ys = [], []
    rng = random.Random(seed)
    for g in range(games):
        dice = random.Random(seed * 7919 + g)
        state = new_game(preset, players)
        positions = []
        step = 0
        while state.phase != 'over':
            if state.phase == 'roll':
                state = apply_roll(state, dice.randint(1, 6))
                continue
            moves = distinct(legal_moves(state))
            state = apply_move(state, moves[0] if len(moves) == 1 else agent.choose(state, moves, rng))
            step += 1
            if step % sample_every == 0 and state.phase != 'over':
                positions.append([relative_features(state, s) for s in range(players)])
        place = {seat: i for i, seat in enumerate(state.ranking)}
        for feats in positions:
            for s in range(players):
                xs.append(feats[s])
                ys.append(1 - 2 * place[s] / (players - 1))
    return xs, ys


def fit(xs, ys, ridge: float = 1e-3):
    import numpy as np

    x = np.asarray(xs, dtype=float)
    y = np.asarray(ys, dtype=float)
    a = x.T @ x + ridge * len(x) * np.eye(x.shape[1])
    w = np.linalg.solve(a, x.T @ y)
    return [float(v) for v in w]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--preset', default='classique', choices=['classique', 'rapide', 'six'])
    ap.add_argument('--players', type=int, default=2)
    ap.add_argument('--games', type=int, default=200, help='parties par génération')
    ap.add_argument('--generations', type=int, default=3)
    ap.add_argument('--epsilon', type=float, default=0.1)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--eval-deals', type=int, default=40, help='donnes du match final contre le glouton')
    ap.add_argument('--out', default=None, help='fichier JSON exporté (kwatt-ludo-eval)')
    args = ap.parse_args(argv)

    t0 = time.time()
    agent = GreedyAgent()
    weights = None
    total = 0
    for gen in range(args.generations):
        xs, ys = self_play(agent, args.preset, args.players, args.games, args.seed + gen)
        total += args.games
        weights = fit(xs, ys)
        agent = LinearAgent(weights, epsilon=args.epsilon)
        print(f'génération {gen + 1} : {len(xs)} positions, poids {", ".join(f"{f}={w:+.3f}" for f, w in zip(FEATURES, weights))}')
    final = LinearAgent(weights, name='appris')
    r = run_match(final, GreedyAgent(), args.preset, args.players, args.eval_deals, seed=args.seed + 1000)
    p, lo, hi = r.interval
    print(f'contre le glouton : {r.wins}/{r.games} = {100 * p:.1f} % [{100 * lo:.1f} ; {100 * hi:.1f}] — {time.time() - t0:.0f} s')
    if args.out:
        model = {
            'format': 'kwatt-ludo-eval',
            'version': 1,
            'preset': args.preset,
            'features': list(FEATURES),
            'weights': [round(TERMINAL * w, 6) for w in weights],
            'bias': 0,
            'meta': {
                'method': 'régression de Monte-Carlo par auto-jeu',
                'players': args.players,
                'games': total,
                'generations': args.generations,
                'seed': args.seed,
                'vsGreedy': {'games': r.games, 'wins': r.wins, 'p': round(p, 4), 'low': round(lo, 4), 'high': round(hi, 4)},
                'trainedAt': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
            },
        }
        with open(args.out, 'w', encoding='utf-8') as f:
            json.dump(model, f, ensure_ascii=False, indent=2)
            f.write('\n')
        print(f'modèle exporté : {args.out}')


if __name__ == '__main__':
    main()
