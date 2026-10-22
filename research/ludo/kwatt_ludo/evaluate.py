"""Harnais d'évaluation : matchs entre agents, places tournées, lancers communs.

    python3 -m kwatt_ludo.evaluate --a glouton --b aléatoire --preset classique --players 2 --deals 100
    python3 -m kwatt_ludo.evaluate --a models/classique-linear.json --b glouton

Une « donne » est une suite de lancers fixée (graine) ; elle est rejouée pour
chaque rotation des places, comme le banc d'essai TypeScript. Le résultat
donne le taux de victoires du joueur A avec son intervalle de Wilson à 95 %.
"""

from __future__ import annotations

import argparse
import json
import math
import random
from dataclasses import dataclass

from .agents import Agent, GreedyAgent, LinearAgent, RandomAgent, distinct
from .rules import apply_move, apply_roll, legal_moves, new_game

Z95 = 1.959963984540054


def wilson(successes: int, n: int, z: float = Z95):
    if n == 0:
        return 0.0, 0.0, 1.0
    p = successes / n
    z2 = z * z
    denom = 1 + z2 / n
    center = (p + z2 / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom
    return p, max(0.0, center - half), min(1.0, center + half)


def play_game(preset: str, players: int, seating: list, agents: list, dice_seed: int, agent_seed: int, teams=None):
    """Joue une partie ; ``seating[siège]`` = index de l'agent. Renvoie le classement des sièges."""
    dice = random.Random(dice_seed)
    rng = random.Random(agent_seed)
    state = new_game(preset, players, teams)
    guard = 0
    while state.phase != 'over':
        guard += 1
        if guard > 200_000:
            raise RuntimeError('partie trop longue')
        if state.phase == 'roll':
            state = apply_roll(state, dice.randint(1, 6))
            continue
        moves = distinct(legal_moves(state))
        agent = agents[seating[state.current]]
        state = apply_move(state, moves[0] if len(moves) == 1 else agent.choose(state, moves, rng))
    return state.ranking


@dataclass
class MatchResult:
    games: int
    wins: int

    @property
    def interval(self):
        return wilson(self.wins, self.games)


def run_match(a: Agent, b: Agent, preset='classique', players=2, deals=50, seed=7) -> MatchResult:
    """A au siège 0, B aux autres ; chaque donne est jouée dans toutes les rotations des places."""
    agents = [a] + [b] * (players - 1)
    wins = games = 0
    for d in range(deals):
        dice_seed = seed * 1_000_003 + d
        for r in range(players):
            seating = [(seat + r) % players for seat in range(players)]
            ranking = play_game(preset, players, seating, agents, dice_seed, dice_seed * 31 + r)
            games += 1
            if seating[ranking[0]] == 0:
                wins += 1
    return MatchResult(games, wins)


def load_agent(spec: str) -> Agent:
    if spec in ('aléatoire', 'random'):
        return RandomAgent()
    if spec in ('glouton', 'greedy'):
        return GreedyAgent()
    with open(spec, encoding='utf-8') as f:
        model = json.load(f)
    if model.get('format') != 'kwatt-ludo-eval':
        raise ValueError(f'modèle inconnu : {spec}')
    return LinearAgent(model['weights'], model.get('bias', 0.0), name=spec)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--a', default='glouton')
    ap.add_argument('--b', default='aléatoire')
    ap.add_argument('--preset', default='classique', choices=['classique', 'rapide', 'six'])
    ap.add_argument('--players', type=int, default=2)
    ap.add_argument('--deals', type=int, default=50)
    ap.add_argument('--seed', type=int, default=7)
    args = ap.parse_args(argv)
    r = run_match(load_agent(args.a), load_agent(args.b), args.preset, args.players, args.deals, args.seed)
    p, lo, hi = r.interval
    print(f'{args.preset} à {args.players} : {args.a} contre {args.b} — {r.games} parties, '
          f'victoires de A {r.wins} = {100 * p:.1f} % [{100 * lo:.1f} ; {100 * hi:.1f}] (hasard : {100 / args.players:.1f} %)')


if __name__ == '__main__':
    main()
