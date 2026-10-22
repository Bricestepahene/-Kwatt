"""Caractéristiques d'une position pour l'évaluation apprise.

Mêmes définitions que ``stateFeatures`` de ``@kwatt/ludo-ai`` (learned.ts) :
les fixtures d'or contiennent les valeurs calculées par le moteur TypeScript,
et les tests vérifient que Python retrouve les mêmes.
"""

from __future__ import annotations

from .rules import BASE, State, absolute_square, is_safe, team_of

FEATURES = ('progress', 'base', 'home', 'corridor', 'exposed')


def progress_on_square(state: State, home: int, square: int):
    """Progression à laquelle une maison passe sur une case de piste (None si jamais)."""
    t = state.topo
    start = (home * t['block']) % t['track']
    p = (square - start) % t['track']
    return p if p <= t['last_track'] else None


def state_features(state: State, seat: int) -> list:
    t = state.topo
    end, lt = t['finish'], t['last_track']
    lst = state.tokens[seat]
    n = len(lst)
    home = state.homes[seat]
    progress = base = done = corridor = exposed = 0.0
    for p in lst:
        if p == BASE:
            base += 1
            continue
        progress += (p + 1) / (end + 1)
        if p == end:
            done += 1
        elif p > lt:
            corridor += 1
        sq = absolute_square(state, home, p)
        if sq is None or is_safe(state, sq):
            continue
        threatened = False
        for o, other in enumerate(state.tokens):
            if threatened or team_of(state, o) == team_of(state, seat) or state.status[o] != 'playing':
                continue
            q = progress_on_square(state, state.homes[o], sq)
            if q is None:
                continue
            for op in other:
                if op != BASE and op < q and q - op <= 6 and absolute_square(state, state.homes[o], op) is not None:
                    threatened = True
        if threatened:
            exposed += 1
    return [progress / n, base / n, done / n, corridor / n, exposed / n]


def relative_features(state: State, seat: int) -> list:
    """Caractéristiques du siège moins la moyenne des adversaires (entrée du modèle linéaire)."""
    mine = state_features(state, seat)
    opps = [state_features(state, o) for o in range(len(state.tokens)) if team_of(state, o) != team_of(state, seat)]
    if not opps:
        return mine
    return [m - sum(o[k] for o in opps) / len(opps) for k, m in enumerate(mine)]
