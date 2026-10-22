/**
 * Écrit les fixtures d'or du moteur TypeScript pour le simulateur Python :
 *
 *   pnpm --filter @kwatt/ludo-ai-service golden
 *
 * → research/ludo/fixtures/golden.jsonl.gz (une partie par ligne, compressé).
 * Un test vérifie que le fichier versionné est à jour (il compare le texte
 * décompressé, pas les octets : la compression peut varier d'une version de zlib à l'autre).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { goldenJsonl } from '@kwatt/ludo-ai';
import { isMain } from './pool.js';

export const GOLDEN_PATH = fileURLToPath(new URL('../../../../research/ludo/fixtures/golden.jsonl.gz', import.meta.url));

export function readGolden(path = GOLDEN_PATH): string {
  return gunzipSync(readFileSync(path)).toString('utf8');
}

export function writeGolden(path = GOLDEN_PATH): void {
  writeFileSync(path, gzipSync(Buffer.from(goldenJsonl(), 'utf8'), { level: 9 }));
}

if (isMain(import.meta.url)) {
  writeGolden();
  console.log(`fixtures écrites : ${GOLDEN_PATH}`);
}
