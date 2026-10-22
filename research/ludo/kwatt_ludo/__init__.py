"""Recherche sur le Ludo de Kwatt : simulateur, agents, évaluation, auto-jeu.

Hors production : la machine qui joue vraiment est ``@kwatt/ludo-ai``
(TypeScript). Ce paquet sert à mesurer et à entraîner, puis à exporter une
évaluation au format ``kwatt-ludo-eval`` que ``linearEvaluator`` charge.
"""

from .rules import BASE, LudoError, Move, State, apply_move, apply_roll, legal_moves, new_game  # noqa: F401
