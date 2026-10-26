"""Simulateur du Ludo classique (croix 15 x 15 et étoile à 6 branches).

Réécriture en Python de ``@kwatt/rules-ludo`` pour les variantes Classique,
Rapide et 6 joueurs (sans barrières, sans bonus, sans cauris). Il sert à la
recherche (auto-jeu, évaluation) et doit rester **identique** au moteur
TypeScript : chaque version rejoue les fixtures d'or exportées par le moteur
(``fixtures/golden.jsonl.gz``) et doit retrouver les mêmes coups légaux et
les mêmes positions (``python -m unittest``).

Le moteur TypeScript fait foi : en cas de désaccord, c'est ce fichier qu'on corrige.
Bibliothèque standard seulement (pas de NumPy ici).
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Optional

BASE = -1

# Forme des plateaux : longueur de la piste, dernière progression sur la piste, arrivée.
BOARDS = {
    'croix': {'homes': 4, 'track': 52, 'block': 13, 'last_track': 50, 'finish': 56},
    'etoile': {'homes': 6, 'track': 78, 'block': 13, 'last_track': 76, 'finish': 82},
}

SEATING = {
    'croix': {2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3]},
    'etoile': {2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5]},
}

# Préréglages couverts (mêmes valeurs que PRESETS dans variants.ts).
PRESETS = {
    'classique': {'board': 'croix', 'players': (2, 4), 'tokens': 4, 'exit': (6,), 'capture_roll': False, 'safe': (0, 8), 'team_sizes': (2,)},
    'rapide': {'board': 'croix', 'players': (2, 4), 'tokens': 2, 'exit': (6, 1), 'capture_roll': True, 'safe': (0,), 'team_sizes': ()},
    'six': {'board': 'etoile', 'players': (2, 6), 'tokens': 4, 'exit': (6,), 'capture_roll': False, 'safe': (0, 8), 'team_sizes': (2, 3)},
}

MAX_SIXES = 3


class LudoError(Exception):
    """Coup ou lancer refusé (même sens que LudoError côté TypeScript)."""


@dataclass(frozen=True)
class Move:
    seat: int
    token: int
    frm: int
    to: int
    captures: tuple  # ((siège, pion), …)

    def compact(self) -> list:
        return [self.seat, self.token, self.frm, self.to, [list(c) for c in self.captures]]


@dataclass
class State:
    preset: str
    board: str
    teams: list
    homes: list  # maison de chaque siège
    status: list  # 'playing' | 'finished' | 'out'
    tokens: list  # progression de chaque pion, par siège
    current: int = 0
    phase: str = 'roll'
    roll: Optional[int] = None
    sixes: int = 0
    turn_no: int = 1
    ranking: list = field(default_factory=list)
    extra_roll: bool = False

    # --- accès à la configuration ---------------------------------------------------
    @property
    def preset_info(self) -> dict:
        return PRESETS[self.preset]

    @property
    def topo(self) -> dict:
        return BOARDS[self.board]

    def copy(self) -> 'State':
        return replace(self, tokens=[list(t) for t in self.tokens], status=list(self.status), ranking=list(self.ranking))


def new_game(preset: str, players: int, teams: Optional[list] = None) -> State:
    info = PRESETS[preset]
    lo, hi = info['players']
    if not (lo <= players <= hi):
        raise LudoError('ludo.setup.players')
    homes = SEATING[info['board']][players]
    return State(
        preset=preset,
        board=info['board'],
        teams=[list(t) for t in (teams or [])],
        homes=list(homes),
        status=['playing'] * players,
        tokens=[[BASE] * info['tokens'] for _ in homes],
    )


# --- parcours -----------------------------------------------------------------------

def absolute_square(state: State, home: int, progress: int) -> Optional[int]:
    t = state.topo
    if progress < 0 or progress > t['last_track']:
        return None
    return (home * t['block'] + progress) % t['track']


def is_safe(state: State, square: int) -> bool:
    return (square % state.topo['block']) in state.preset_info['safe']


def team_of(state: State, seat: int) -> int:
    for i, t in enumerate(state.teams):
        if seat in t:
            return i
    return -1 - seat


def partners(state: State, a: int, b: int) -> bool:
    return a == b or team_of(state, a) == team_of(state, b)


def occupancy(state: State) -> dict:
    occ: dict = {}
    for seat, lst in enumerate(state.tokens):
        if state.status[seat] == 'out':
            continue
        for token, p in enumerate(lst):
            sq = absolute_square(state, state.homes[seat], p)
            if sq is not None:
                occ.setdefault(sq, []).append((seat, token))
    return occ


def controlled_seats(state: State, seat: int) -> list:
    # Ces variantes ne font jamais jouer un partenaire : seulement soi, tant qu'on joue.
    return [seat] if state.status[seat] == 'playing' else []


# --- coups --------------------------------------------------------------------------

def moves_for(state: State, seat: int, roll: int) -> list:
    occ = occupancy(state)
    finish = state.topo['finish']
    info = state.preset_info
    out = []
    for owner in controlled_seats(state, seat):
        home = state.homes[owner]
        for token, frm in enumerate(state.tokens[owner]):
            if frm == BASE:
                if roll not in info['exit']:
                    continue
                to = 0
            else:
                if frm >= finish:
                    continue
                to = frm + roll
                if to > finish:
                    continue
            sq = absolute_square(state, home, to)
            captures: tuple = ()
            if sq is not None and not is_safe(state, sq):
                captures = tuple(o for o in occ.get(sq, []) if o != (owner, token) and not partners(state, owner, o[0]))
            out.append(Move(owner, token, frm, to, captures))
    return out


def legal_moves(state: State) -> list:
    if state.phase != 'move' or state.roll is None:
        return []
    return moves_for(state, state.current, state.roll)


# --- déroulé ------------------------------------------------------------------------

def total_progress(state: State, seat: int) -> int:
    return sum(0 if p == BASE else p + 1 for p in state.tokens[seat])


def _progress_key(state: State, seat: int) -> tuple:
    finish = state.topo['finish']
    home = sum(1 for p in state.tokens[seat] if p == finish)
    return (-total_progress(state, seat), -home, -max(state.tokens[seat]), seat)


def _close(state: State) -> State:
    s = state.copy()
    rest = sorted((i for i, st in enumerate(s.status) if st == 'playing' and i not in s.ranking), key=lambda i: _progress_key(s, i))
    s.ranking.extend(rest)
    out = [i for i, st in enumerate(s.status) if st == 'out']
    s.ranking.extend(i for i in reversed(out) if i not in s.ranking)
    s.phase = 'over'
    s.roll = None
    s.extra_roll = False
    return s


def _finalize(state: State) -> State:
    if state.phase == 'over':
        return state
    playing = [i for i, st in enumerate(state.status) if st == 'playing']
    camps = {team_of(state, i) for i in playing}
    team_done = bool(state.teams) and any(all(state.status[s] == 'finished' for s in t) for t in state.teams)
    if len(camps) > 1 and not team_done:
        return state
    return _close(state)


def _next_turn(state: State) -> State:
    done = _finalize(state)
    if done.phase == 'over':
        return done
    n = len(done.status)
    nxt = done.current
    for i in range(1, n + 1):
        c = (done.current + i) % n
        if controlled_seats(done, c):
            nxt = c
            break
    s = done.copy()
    s.current, s.phase, s.roll, s.sixes, s.turn_no, s.extra_roll = nxt, 'roll', None, 0, done.turn_no + 1, False
    return s


def _continue_turn(state: State) -> State:
    done = _finalize(state)
    if done.phase == 'over':
        return done
    if controlled_seats(done, done.current) and done.extra_roll:
        s = done.copy()
        s.extra_roll, s.phase, s.roll = False, 'roll', None
        return s
    return _next_turn(done)


def apply_roll(state: State, value: int) -> State:
    if state.phase != 'roll':
        raise LudoError('ludo.roll.not_now')
    if not (isinstance(value, int) and 1 <= value <= 6):
        raise LudoError('ludo.roll.invalid_value')
    sixes = state.sixes + 1 if value == 6 else 0
    if value == 6 and sixes >= MAX_SIXES:
        # Trois 6 de suite : le tour passe sans jouer.
        s = state.copy()
        s.roll, s.sixes = value, 0
        return _next_turn(s)
    s = state.copy()
    s.roll, s.sixes, s.phase, s.extra_roll = value, sixes, 'move', value == 6
    if not legal_moves(s):
        return _continue_turn(s)
    return s


def apply_move(state: State, move: Move) -> State:
    """Applique un coup tiré de ``legal_moves(state)``."""
    s = state.copy()
    finish = s.topo['finish']
    s.tokens[move.seat][move.token] = move.to
    for seat, token in move.captures:
        s.tokens[seat][token] = BASE
    if all(p == finish for p in s.tokens[move.seat]):
        s.status[move.seat] = 'finished'
        s.ranking.append(move.seat)
    s.extra_roll = state.extra_roll or (s.preset_info['capture_roll'] and len(move.captures) > 0)
    return _continue_turn(s)


def play_token(state: State, token: int) -> State:
    """Joue le pion ``token`` (le coup est cherché parmi les coups légaux)."""
    for m in legal_moves(state):
        if m.token == token:
            return apply_move(state, m)
    raise LudoError('ludo.move.illegal')


def compact(state: State) -> dict:
    """Position condensée, au format des fixtures d'or (sans les caractéristiques)."""
    return {
        'tokens': [list(t) for t in state.tokens],
        'current': state.current,
        'phase': state.phase,
        'roll': state.roll,
        'sixesInRow': state.sixes,
        'turnNo': state.turn_no,
        'ranking': list(state.ranking),
        'status': list(state.status),
    }
