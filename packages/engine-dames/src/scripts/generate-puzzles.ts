/**
 * Générateur des problèmes du jour :
 *   pnpm --filter @kwatt/engine-dames puzzles -- dames10 140 [parties max] [graine] [fichier]
 *   pnpm --filter @kwatt/engine-dames puzzles -- merge dames10 part1.json part2.json…
 *
 * Fait jouer le moteur contre lui-même à des forces modestes (positions de
 * partie réalistes, riches en occasions tactiques), repère les positions où
 * une combinaison forcée existe (filtre rapide, puis `findPuzzle` et ses
 * contrôles), et écrit `puzzles/<variante>.json`. Reproductible : même
 * graine, même fichier. Le mode `merge` réunit des fichiers produits en
 * parallèle (graines différentes), sans doublon, et renumérote.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { applyMove, initialState, legalMoves, positionKey, type DamesState, type Variant } from '@kwatt/rules-dames';
import { Position } from '../core.js';
import { defaultWeights, evaluate } from '../evaluate.js';
import { chooseMoveSync } from '../play.js';
import { findPuzzle, puzzleState, verifyPuzzle, type Puzzle, type PuzzleFile } from '../puzzles.js';
import { mulberry32 } from '../random.js';
import { Search, runSync } from '../search.js';

const outDir = new URL('../../puzzles/', import.meta.url);

function write(variant: Variant, puzzles: Omit<Puzzle, 'id'>[], name: string): void {
  const prefix = variant === 'dames10' ? 'd10' : 'd8';
  const order = [...puzzles].sort((a, b) => a.difficulty - b.difficulty || a.theme.localeCompare(b.theme));
  const file: PuzzleFile = {
    version: 1,
    variant,
    puzzles: order.map((p, i) => ({ id: `${prefix}-${String(i + 1).padStart(3, '0')}`, ...p })),
  };
  mkdirSync(outDir, { recursive: true });
  // Un problème par ligne : lisible et facile à relire dans un diff.
  const body = file.puzzles.map((p) => '  ' + JSON.stringify(p)).join(',\n');
  writeFileSync(new URL(name, outDir), `{\n "version": 1,\n "variant": "${variant}",\n "puzzles": [\n${body}\n ]\n}\n`);
}

function strip(p: Puzzle): Omit<Puzzle, 'id'> {
  const { id: _id, ...rest } = p;
  return rest;
}

if (process.argv[2] === 'merge') {
  const variant: Variant = process.argv[3] === 'dames8' ? 'dames8' : 'dames10';
  const all: Omit<Puzzle, 'id'>[] = [];
  const keys = new Set<string>();
  for (const f of process.argv.slice(4)) {
    const file = JSON.parse(readFileSync(new URL(f, outDir), 'utf8')) as PuzzleFile;
    for (const p of file.puzzles) {
      const s = puzzleState(p);
      const key = positionKey(s.board, s.turn);
      if (keys.has(key) || !verifyPuzzle(p).ok) continue;
      keys.add(key);
      all.push(strip(p));
    }
  }
  write(variant, all, `${variant}.json`);
  console.log(`${all.length} problèmes réunis dans ${variant}.json`);
} else {
  const variant: Variant = process.argv[2] === 'dames8' ? 'dames8' : 'dames10';
  const target = Number(process.argv[3] ?? (variant === 'dames10' ? 140 : 30));
  const maxGames = Number(process.argv[4] ?? 3000);
  const seed = Number(process.argv[5] ?? 2026);
  const name = process.argv[6] ?? `${variant}.json`;

  const found: Omit<Puzzle, 'id'>[] = [];
  const seen = new Set<string>();
  // Joueurs modestes et rapides : ils laissent des occasions tactiques à l'adversaire.
  const ratings = [800, 950, 1100, 1250];
  const started = Date.now();
  let candidates = 0;

  /** Filtre rapide : une petite recherche voit-elle un gain net ? */
  const promising = (state: DamesState): boolean => {
    if (legalMoves(state).length < 2) return false;
    const pos = Position.fromState(state);
    const static0 = evaluate(pos, defaultWeights(pos.g.size));
    const r = runSync(new Search(pos, { weights: defaultWeights(pos.g.size), maxDepth: 4, maxNodes: 2_500 }).run());
    return r.score - static0 >= 140;
  };

  const themeCount = new Map<string, number>();
  for (let g = 0; g < maxGames && found.length < target; g++) {
    const random = mulberry32(seed * 100_003 + g);
    let state = initialState(variant);
    const rw = ratings[Math.floor(random() * ratings.length)]!;
    const rb = ratings[Math.floor(random() * ratings.length)]!;
    for (let i = 0; i < 4 && !state.result; i++) {
      const ms = legalMoves(state);
      state = applyMove(state, ms[Math.floor(random() * ms.length)]!);
    }
    let quietUntil = 0;
    for (let ply = 0; ply < 140 && !state.result && found.length < target; ply++) {
      const key = positionKey(state.board, state.turn);
      if (ply >= 4 && ply >= quietUntil && !seen.has(key) && promising(state)) {
        seen.add(key);
        candidates++;
        const p = findPuzzle(state);
        // Pas plus d'un quart de problèmes « choisir la bonne prise » (les plus faciles).
        const share = (themeCount.get('capture_choice') ?? 0) / Math.max(4, found.length);
        if (p && !(p.theme === 'capture_choice' && share >= 0.25)) {
          found.push(p);
          // Les positions qui suivent appartiennent à la même combinaison.
          quietUntil = ply + 10;
          themeCount.set(p.theme, (themeCount.get(p.theme) ?? 0) + 1);
          if (found.length % 5 === 0) write(variant, found, name);
          console.log(
            `${found.length}/${target} · partie ${g} · ${p.theme} · difficulté ${p.difficulty} · ${p.solution.join(' ')} · ${Math.round((Date.now() - started) / 1000)} s`,
          );
        }
      }
      const c = chooseMoveSync(state, { targetRating: state.turn === 'w' ? rw : rb, seed: g * 7919 + ply, maxNodes: 3_000 });
      state = applyMove(state, c.move);
    }
  }
  write(variant, found, name);
  console.log(`${found.length} problèmes (${candidates} candidats examinés) · ${[...themeCount].map(([t, n]) => `${t} ${n}`).join(', ')}`);
}
