/**
 * Match de contrôle entre deux forces, en ligne de commande :
 *   pnpm --filter @kwatt/engine-dames match -- dames10 1800 1550 10
 * (variante, force A, force B, parties ; « fon » = pleine force).
 */
import type { Variant } from '@kwatt/rules-dames';
import { playMatch } from '../match.js';

const [variantArg, aArg, bArg, gamesArg] = process.argv.slice(2);
const variant: Variant = variantArg === 'dames8' ? 'dames8' : 'dames10';
const rating = (s: string | undefined, fallback: number | null): number | null => (s === undefined ? fallback : s === 'fon' ? null : Number(s));
const ratingA = rating(aArg, null);
const ratingB = rating(bArg, 1550);
const games = Number(gamesArg ?? 4);
const started = Date.now();
const r = playMatch({ variant, ratingA, ratingB, games });
r.games.forEach((g, i) => console.log(`partie ${i + 1} : A ${g.aIsWhite ? 'blancs' : 'noirs'}, ${g.plies} demi-coups, A marque ${g.scoreA}${g.adjudicated ? ' (arbitrée)' : ''}`));
console.log(`${variant} · A (${ratingA ?? 'Fon'}) ${r.scoreA} – ${r.scoreB} B (${ratingB ?? 'Fon'}) · ${Math.round((Date.now() - started) / 1000)} s`);
