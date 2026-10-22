"""Le simulateur Python rejoue les fixtures d'or du moteur TypeScript.

Chaque pas : même lancer (ou même coup) → mêmes coups légaux, même position,
mêmes caractéristiques. Une divergence est une erreur du simulateur Python.
Lancer : ``cd research/ludo && python3 -m unittest`` (régénérer les fixtures :
``pnpm --filter @kwatt/ludo-ai-service golden``).
"""

import gzip
import json
import unittest
from pathlib import Path

from kwatt_ludo.features import state_features
from kwatt_ludo.rules import LudoError, apply_move, apply_roll, compact, legal_moves, new_game, play_token

FIXTURES = Path(__file__).resolve().parent.parent / 'fixtures' / 'golden.jsonl.gz'


def load_games():
    with gzip.open(FIXTURES, 'rt', encoding='utf-8') as f:
        return [json.loads(line) for line in f if line.strip()]


class GoldenFixtures(unittest.TestCase):
    def test_replay_all_games(self):
        games = load_games()
        self.assertGreaterEqual(len(games), 10)
        presets = set()
        for g in games:
            self.assertEqual(g['format'], 'kwatt-ludo-golden')
            opts = g['options']
            presets.add(opts['preset'])
            state = new_game(opts['preset'], opts['players'], opts['teams'] or None)
            for i, step in enumerate(g['steps']):
                where = f"{opts['preset']} à {opts['players']}, pas {i}"
                if 'roll' in step:
                    state = apply_roll(state, step['roll'])
                else:
                    state = apply_move(state, legal_moves(state)[step['move']])
                expected = dict(step['state'])
                features = expected.pop('features')
                self.assertEqual(compact(state), expected, where)
                self.assertEqual([m.compact() for m in legal_moves(state)], step['legal'], where)
                for seat, f in enumerate(features):
                    for a, b in zip(state_features(state, seat), f):
                        self.assertAlmostEqual(a, b, places=7, msg=where)
            self.assertEqual(state.phase, 'over')
        self.assertEqual(presets, {'classique', 'rapide', 'six'})


class Rules(unittest.TestCase):
    def test_exit_and_extra_roll(self):
        g = apply_roll(new_game('classique', 2), 6)
        self.assertEqual(len(legal_moves(g)), 4)
        g = play_token(g, 0)
        self.assertEqual(g.tokens[0][0], 0)
        self.assertEqual((g.current, g.phase), (0, 'roll'))

    def test_errors(self):
        g = new_game('classique', 2)
        with self.assertRaises(LudoError):
            apply_roll(g, 7)
        with self.assertRaises(LudoError):
            new_game('classique', 5)
        with self.assertRaises(LudoError):
            play_token(apply_roll(g, 6), 9)


if __name__ == '__main__':
    unittest.main()
