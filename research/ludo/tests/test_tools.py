"""Outils de recherche : harnais d'évaluation, auto-jeu, format du modèle exporté.

Lancer : ``cd research/ludo && python3 -m unittest``.
"""

import json
import unittest
from pathlib import Path

from kwatt_ludo.agents import GreedyAgent, LinearAgent, RandomAgent
from kwatt_ludo.evaluate import run_match, wilson
from kwatt_ludo.features import FEATURES
from kwatt_ludo.train import self_play

MODEL = Path(__file__).resolve().parent.parent / 'models' / 'classique-linear.json'
# Mêmes caractéristiques que LEARNED_FEATURES de packages/ludo-ai/src/learned.ts.
TS_FEATURES = ('progress', 'base', 'home', 'corridor', 'exposed')


class Evaluate(unittest.TestCase):
    def test_wilson(self):
        p, lo, hi = wilson(50, 100)
        self.assertAlmostEqual(p, 0.5)
        self.assertLess(lo, 0.5)
        self.assertGreater(hi, 0.5)
        self.assertEqual(wilson(0, 0), (0.0, 0.0, 1.0))

    def test_match_is_deterministic_and_rotates_seats(self):
        a = run_match(GreedyAgent(), RandomAgent(), 'classique', 2, deals=3, seed=5)
        b = run_match(GreedyAgent(), RandomAgent(), 'classique', 2, deals=3, seed=5)
        self.assertEqual((a.games, a.wins), (b.games, b.wins))
        # Chaque donne est jouée dans les deux rotations des places.
        self.assertEqual(a.games, 6)


class Train(unittest.TestCase):
    def test_self_play_samples(self):
        xs, ys = self_play(GreedyAgent(), 'classique', 2, games=2, seed=3)
        self.assertGreater(len(xs), 0)
        self.assertEqual(len(xs), len(ys))
        self.assertTrue(all(len(x) == len(FEATURES) for x in xs))
        self.assertTrue(all(-1 <= y <= 1 for y in ys))


class ExportedModel(unittest.TestCase):
    def test_model_matches_typescript_loader(self):
        model = json.loads(MODEL.read_text(encoding='utf-8'))
        self.assertEqual(model['format'], 'kwatt-ludo-eval')
        self.assertEqual(model['version'], 1)
        self.assertEqual(tuple(model['features']), TS_FEATURES)
        self.assertEqual(tuple(FEATURES), TS_FEATURES)
        self.assertEqual(len(model['weights']), len(model['features']))
        # Avancer est bon, rester à la base est mauvais.
        self.assertGreater(model['weights'][0], 0)
        self.assertLess(model['weights'][1], 0)

    def test_linear_agent_plays(self):
        model = json.loads(MODEL.read_text(encoding='utf-8'))
        weights = [w / 12 for w in model['weights']]
        r = run_match(LinearAgent(weights, name='appris'), RandomAgent(), 'classique', 2, deals=2, seed=9)
        self.assertEqual(r.games, 4)


if __name__ == '__main__':
    unittest.main()
