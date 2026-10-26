/**
 * Tournoi en ligne de commande :
 *
 *   pnpm --filter @kwatt/ludo-ai-service bench -- --preset classique --players 4 \
 *     --a level:fon:400 --b level:coriace --deals 100 [--workers 3] [--seed 7] [--sprt 0.25,0.32] [--json]
 *
 * Le joueur A est au siège 0, B aux autres ; les places tournent à chaque donne
 * et chaque donne garde la même suite de lancers (nombres aléatoires communs).
 * Joueurs : level:<niveau>[:itérations] · random · heuristic:<exact|fast|none> ·
 * emx:<maxn|paranoid>:<profondeur>[:poids=valeur,…] · mcts:<itérations>.
 * Avec --sprt p0,p1 : test séquentiel sur les victoires de A (un seul fil).
 */
import { eloFromScore, LEVELS, runMatch, type Level, type MatchResult } from '@kwatt/ludo-ai';
import { PRESET_IDS, type NewGameOptions, type Preset } from '@kwatt/rules-ludo';
import { defaultWorkers, isMain, runPooled, specLabel, toPlayer, type PlayerSpec } from './pool.js';

export function parseSpec(text: string): PlayerSpec {
  const [kind, a, b, c] = text.split(':');
  switch (kind) {
    case 'level':
      if (!LEVELS.includes(a as Level)) throw new Error(`niveau inconnu : ${a}`);
      return { kind: 'level', level: a as Level, ...(b ? { iters: Number(b) } : {}) };
    case 'random':
      return { kind: 'random' };
    case 'heuristic':
      return { kind: 'heuristic', threats: (a ?? 'exact') as 'exact' | 'fast' | 'none' };
    case 'emx':
      return {
        kind: 'expectimax',
        mode: (a ?? 'paranoid') as 'maxn' | 'paranoid',
        depth: Number(b ?? 2),
        ...(c ? { weights: Object.fromEntries(c.split(',').map((kv) => [kv.split('=')[0]!, Number(kv.split('=')[1])])) } : {}),
      };
    case 'mcts':
      return { kind: 'mcts', iters: Number(a ?? 400) };
    default:
      throw new Error(`joueur inconnu : ${text}`);
  }
}

export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    if (!k.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[k.slice(2)] = 'true';
    else {
      out[k.slice(2)] = next;
      i++;
    }
  }
  return out;
}

export function gameOptions(preset: string, players: number): NewGameOptions {
  if (!PRESET_IDS.includes(preset as Preset)) throw new Error(`variante inconnue : ${preset}`);
  const teams = preset === 'pachisi' ? { teams: [[0, 2], [1, 3]] } : {};
  return { preset: preset as Preset, players, ...teams };
}

export function describe(result: MatchResult, title: string): string {
  const lines = [`${title} — ${result.games} parties`];
  for (const p of result.players) {
    lines.push(
      `  ${p.label.padEnd(24)} victoires ${String(p.wins).padStart(5)}  ${(100 * p.winRate.p).toFixed(1)} % [${(100 * p.winRate.low).toFixed(1)} ; ${(100 * p.winRate.high).toFixed(1)}]  score ${p.score.mean.toFixed(3)}  place ${p.meanPlace.toFixed(2)}`,
    );
  }
  if (result.players.length === 2) lines.push(`  écart façon Elo (A − B) : ${eloFromScore(result.players[0]!.score.mean).toFixed(0)}`);
  if (result.sprt) lines.push(`  SPRT : ${result.sprt.verdict} (LLR ${result.sprt.llr.toFixed(2)}, ${result.sprt.games} parties)`);
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const players = Number(args.players ?? 2);
  const game = gameOptions(args.preset ?? 'classique', players);
  const a = parseSpec(args.a ?? 'level:coriace');
  const b = parseSpec(args.b ?? 'random');
  const lineup = [a, ...Array.from({ length: players - 1 }, () => b)];
  const deals = Number(args.deals ?? 50);
  const seed = Number(args.seed ?? 7);
  const t0 = Date.now();
  let result: MatchResult;
  if (args.sprt) {
    const [p0, p1] = args.sprt.split(',').map(Number);
    result = runMatch({ game, lineup: lineup.map(toPlayer), deals, seed, sprt: { p0: p0!, p1: p1! } });
  } else {
    result = await runPooled({ game, lineup, deals, seed }, Number(args.workers ?? defaultWorkers()));
  }
  const title = `${game.preset} à ${players} : ${specLabel(a)} contre ${specLabel(b)}`;
  if (args.json) console.log(JSON.stringify({ title, games: result.games, players: result.players, sprt: result.sprt ?? null }));
  else console.log(`${describe(result, title)}\n  durée ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (isMain(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
