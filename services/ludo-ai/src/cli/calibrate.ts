/**
 * Calibration des difficultés pour les cotes des paris (SPEC §7, cote = 0,9 ÷ p) :
 *
 *   pnpm --filter @kwatt/ludo-ai-service calibrate -- [--deals 150] [--fon-deals 60] [--fon-iters 15000] [--workers 3] [--seed 11]
 *
 * Pour chaque variante classée (classique, rapide, six) et chaque difficulté,
 * le « joueur de référence » (agent Ton niveau, par définition à 50 % contre
 * lui-même) joue en tête-à-tête contre la machine, places tournées, lancers
 * communs. La part de victoires du joueur donne p₂. Un contrôle à 4 joueurs
 * (1 contre 3 Coriace, Classique) vérifie le modèle de Luce de calibration.ts.
 *
 * Réécrit la table de packages/ludo-ai/src/calibration.ts et
 * packages/ludo-ai/CALIBRATION.md. Fon est joué avec un plafond de nœuds
 * (reproductible) et non au temps : la mesure est donc une borne prudente.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LEVELS, playerWinProbability, type Calibration, type CalibrationPoint, type Level, type RankedVariant } from '@kwatt/ludo-ai';
import { gameOptions, parseArgs } from './bench.js';
import { defaultWorkers, isMain, runPooled, type PlayerSpec } from './pool.js';

const CALIBRATION_TS = fileURLToPath(new URL('../../../../packages/ludo-ai/src/calibration.ts', import.meta.url));
const CALIBRATION_MD = fileURLToPath(new URL('../../../../packages/ludo-ai/CALIBRATION.md', import.meta.url));

const VARIANTS: RankedVariant[] = ['classique', 'rapide', 'six'];

interface Row {
  variant: RankedVariant;
  level: Level;
  point: CalibrationPoint;
  meanPlace: number;
  seconds: number;
}

function machineSpec(level: Level, fonIters: number): PlayerSpec {
  // Fon joue au temps dans l'appli et le service ; ici, un plafond d'itérations rend la mesure reproductible.
  return level === 'fon' ? { kind: 'level', level, iters: fonIters, label: `fon(${fonIters})` } : { kind: 'level', level };
}

const REFERENCE: PlayerSpec = { kind: 'level', level: 'ton_niveau', label: 'référence (ton_niveau)' };

const pct = (x: number): string => `${(100 * x).toFixed(1)} %`;
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

function tableSource(cal: Calibration): string {
  const lines = [`export const CALIBRATION: Calibration = {`, `  reference: '${cal.reference}',`, `  measuredAt: '${cal.measuredAt}',`, `  table: {`];
  for (const v of VARIANTS) {
    lines.push(`    ${v}: {`);
    for (const l of LEVELS) {
      const p = cal.table[v][l];
      lines.push(`      ${l}: { p2: ${p.p2}, low: ${p.low}, high: ${p.high}, games: ${p.games} },`);
    }
    lines.push(`    },`);
  }
  lines.push(`  },`, `};`);
  return lines.join('\n');
}

function writeTable(cal: Calibration): void {
  const src = readFileSync(CALIBRATION_TS, 'utf8');
  const start = src.indexOf('export const CALIBRATION: Calibration = {');
  const end = src.indexOf('\n};\n', start);
  if (start < 0 || end < 0) throw new Error('table introuvable dans calibration.ts');
  writeFileSync(CALIBRATION_TS, src.slice(0, start) + tableSource(cal) + src.slice(end + 3));
}

function markdown(cal: Calibration, rows: Row[], check: { measured: CalibrationPoint; predicted: number; meanPlace: number } | null, opts: { deals: number; fonDeals: number; fonIters: number; seed: number }): string {
  const out: string[] = [];
  out.push('# Calibration des difficultés du Ludo');
  out.push('');
  out.push(`Mesure du ${cal.measuredAt}, régénérée par \`pnpm --filter @kwatt/ludo-ai-service calibrate\` (fichier écrit par le script, à ne pas retoucher à la main).`);
  out.push('');
  out.push('## Méthode');
  out.push('');
  out.push(
    `- Le **joueur de référence** est l'agent « Ton niveau » (\`${cal.reference}\`) : par définition, un joueur de ton niveau gagne une partie sur deux contre lui. Il joue en tête-à-tête contre chaque difficulté.`,
  );
  out.push(`- Places tournées à chaque donne, même suite de lancers pour les deux rotations (nombres aléatoires communs), graine ${opts.seed}.`);
  out.push(`- ${opts.deals} donnes (${2 * opts.deals} parties) par difficulté ; Fon : ${opts.fonDeals} donnes, plafonné à ${opts.fonIters} nœuds d'expectimax par coup (au temps, 400 ms, il finit la profondeur 3 dans la grande majorité des coups ; sinon il garde la profondeur 2).`);
  out.push('- p₂ = part de victoires du joueur ; intervalle de Wilson à 95 %. La cote d\'un pari vaut 0,9 ÷ p (SPEC §7).');
  out.push('- À n joueurs (1 contre n − 1 machines du même niveau), `playerWinProbability` passe par un modèle de Luce : pₙ = s ÷ (s + (n − 1)·m) avec p₂ = s ÷ (s + m).');
  out.push('');
  out.push('## Résultats (tête-à-tête)');
  out.push('');
  out.push('| Variante | Difficulté | p₂ du joueur | IC 95 % | Parties | Cote 2 joueurs | p à 4 joueurs (Luce) | Durée |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const p4 = playerWinProbability(r.variant, 4, r.level, cal);
    const odds = 0.9 / playerWinProbability(r.variant, 2, r.level, cal);
    out.push(
      `| ${r.variant} | ${r.level} | ${pct(r.point.p2)} | ${pct(r.point.low)} – ${pct(r.point.high)} | ${r.point.games} | ${odds.toFixed(2)} | ${pct(p4)} | ${r.seconds.toFixed(0)} s |`,
    );
  }
  out.push('');
  out.push('« Ton niveau » n\'est pas mesuré : il vaut 50 % par construction.');
  out.push('');
  if (check) {
    out.push('## Contrôle à 4 joueurs');
    out.push('');
    out.push(
      `Classique, 1 joueur de référence contre 3 Coriace : ${pct(check.measured.p2)} de victoires (IC ${pct(check.measured.low)} – ${pct(check.measured.high)}, ${check.measured.games} parties, place moyenne ${check.meanPlace.toFixed(2)}) ; le modèle de Luce prévoit ${pct(check.predicted)}.`,
    );
    const inside = check.predicted >= check.measured.low && check.predicted <= check.measured.high;
    out.push('');
    out.push(inside ? 'La prévision est dans l\'intervalle de confiance : le modèle est retenu.' : 'La prévision sort de l\'intervalle de confiance : le modèle reste une approximation (à revoir avec plus de parties).');
    out.push('');
  }
  out.push('## Constats');
  out.push('');
  const inversions: string[] = [];
  for (const v of VARIANTS) {
    for (let i = 1; i < LEVELS.length; i++) {
      const easier = LEVELS[i - 1]!;
      const harder = LEVELS[i]!;
      const a = cal.table[v][easier];
      const b = cal.table[v][harder];
      // Inversion nette : la difficulté « plus dure » laisse gagner le joueur plus souvent, hors des marges d'erreur.
      if (b.p2 > a.p2 && b.low > a.high) inversions.push(`${v} : ${harder} (${pct(b.p2)}) plus facile que ${easier} (${pct(a.p2)})`);
      else if (b.p2 > a.p2) inversions.push(`${v} : ${harder} (${pct(b.p2)}) pas plus dur que ${easier} (${pct(a.p2)}), dans la marge d'erreur`);
    }
  }
  if (inversions.length === 0) out.push('- Les difficultés sont bien ordonnées : p₂ décroît de Facile à Fon dans chaque variante.');
  else {
    out.push('- Ordre des difficultés à surveiller :');
    for (const line of inversions) out.push(`  - ${line}`);
    out.push('- Conséquence : la cote suit la mesure (une difficulté pas plus dure ne paie pas plus) ; c\'est l\'agent qu\'il faut renforcer (`levels.ts`), pas la table.');
  }
  out.push('');
  out.push('## Lecture');
  out.push('');
  out.push('- Les difficultés sont bien ordonnées si p₂ décroît de Facile à Fon. La machine ne touche jamais au dé : seule la qualité des décisions change.');
  out.push('- Au Ludo, le hasard pèse lourd : même Fon perd souvent contre un joueur moyen. Les écarts restent plus faibles qu\'aux Dames, et les cotes en tiennent compte.');
  out.push('- À refaire après tout changement d\'agent (`levels.ts`) ; le serveur lit la table de `calibration.ts`.');
  out.push('');
  return out.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const deals = Number(args.deals ?? 150);
  const fonDeals = Number(args['fon-deals'] ?? 60);
  const fonIters = Number(args['fon-iters'] ?? 15000);
  const workers = Number(args.workers ?? defaultWorkers());
  const seed = Number(args.seed ?? 11);
  const today = new Date().toISOString().slice(0, 10);

  const table = {} as Calibration['table'];
  const rows: Row[] = [];
  for (const variant of VARIANTS) {
    const byLevel = {} as Record<Level, CalibrationPoint>;
    for (const level of LEVELS) {
      if (level === 'ton_niveau') {
        byLevel[level] = { p2: 0.5, low: 0.5, high: 0.5, games: 0 };
        continue;
      }
      const t0 = Date.now();
      const n = level === 'fon' ? fonDeals : deals;
      const result = await runPooled({ game: gameOptions(variant, 2), lineup: [REFERENCE, machineSpec(level, fonIters)], deals: n, seed }, workers);
      const me = result.players[0]!;
      const point: CalibrationPoint = { p2: round4(me.winRate.p), low: round4(me.winRate.low), high: round4(me.winRate.high), games: me.games };
      byLevel[level] = point;
      const seconds = (Date.now() - t0) / 1000;
      rows.push({ variant, level, point, meanPlace: me.meanPlace, seconds });
      console.log(`${variant} ${level} : ${pct(point.p2)} [${pct(point.low)} ; ${pct(point.high)}] sur ${point.games} parties (${seconds.toFixed(0)} s)`);
    }
    table[variant] = byLevel;
  }
  const cal: Calibration = { reference: 'ton_niveau@1', measuredAt: today, table };

  let check: { measured: CalibrationPoint; predicted: number; meanPlace: number } | null = null;
  const checkDeals = Number(args['check-deals'] ?? 40);
  if (checkDeals > 0) {
    const result = await runPooled(
      { game: gameOptions('classique', 4), lineup: [REFERENCE, ...Array.from({ length: 3 }, () => machineSpec('coriace', fonIters))], deals: checkDeals, seed },
      workers,
    );
    const me = result.players[0]!;
    check = {
      measured: { p2: round4(me.winRate.p), low: round4(me.winRate.low), high: round4(me.winRate.high), games: me.games },
      predicted: playerWinProbability('classique', 4, 'coriace', cal),
      meanPlace: me.meanPlace,
    };
    console.log(`contrôle à 4 : ${pct(check.measured.p2)} mesuré, ${pct(check.predicted)} prévu`);
  }

  writeTable(cal);
  writeFileSync(CALIBRATION_MD, markdown(cal, rows, check, { deals, fonDeals, fonIters, seed }));
  console.log(`écrit : ${CALIBRATION_TS}\nécrit : ${CALIBRATION_MD}`);
}

if (isMain(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
