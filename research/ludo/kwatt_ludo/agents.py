"""Agents du simulateur Python : aléatoire, glouton, et évaluation linéaire apprise."""

from __future__ import annotations

import random
from typing import Optional, Sequence

from .features import FEATURES, relative_features
from .rules import BASE, Move, State, absolute_square, apply_move, is_safe


class Agent:
    name = 'agent'

    def choose(self, state: State, moves: Sequence[Move], rng: random.Random) -> Move:  # pragma: no cover - interface
        raise NotImplementedError


class RandomAgent(Agent):
    name = 'aléatoire'

    def choose(self, state, moves, rng):
        return moves[rng.randrange(len(moves))]


def greedy_score(state: State, m: Move) -> float:
    """Même politique rapide que ``fastPolicyScore`` (mcts.ts) : prise, rentrée, couloir, sortie, abri, progression."""
    t = state.topo
    end, lt = t['finish'], t['last_track']
    s = 0.0
    for seat, token in m.captures:
        p = state.tokens[seat][token]
        s += 2 + (0.2 + (p + 1) / (end + 1) if p != BASE else 0)
    if m.to == end:
        s += 1.5
    elif m.to > lt >= m.frm:
        s += 1
    if m.frm == BASE:
        s += 0.8
    sq = absolute_square(state, state.homes[m.seat], m.to)
    if sq is not None and is_safe(state, sq):
        s += 0.3
    return s + (m.to - max(m.frm, 0)) / (end + 1)


class GreedyAgent(Agent):
    name = 'glouton'

    def choose(self, state, moves, rng):
        return max(moves, key=lambda m: greedy_score(state, m))


class LinearAgent(Agent):
    """Choisit le coup dont la position d'après a la meilleure valeur w · (moi − adversaires) + biais."""

    def __init__(self, weights: Sequence[float], bias: float = 0.0, epsilon: float = 0.0, name: Optional[str] = None):
        assert len(weights) == len(FEATURES)
        self.weights = list(weights)
        self.bias = bias
        self.epsilon = epsilon
        self.name = name or 'linéaire'

    def value(self, state: State, seat: int) -> float:
        x = relative_features(state, seat)
        return self.bias + sum(w * v for w, v in zip(self.weights, x))

    def choose(self, state, moves, rng):
        if self.epsilon > 0 and rng.random() < self.epsilon:
            return moves[rng.randrange(len(moves))]
        seat = state.current
        return max(moves, key=lambda m: self.value(apply_move(state, m), seat))


def distinct(moves: Sequence[Move]) -> list:
    """Coups réellement différents (mêmes départ et arrivée = même résultat), comme distinctMoves."""
    seen = {}
    for m in moves:
        seen.setdefault((m.seat, m.frm, m.to), m)
    return list(seen.values())
