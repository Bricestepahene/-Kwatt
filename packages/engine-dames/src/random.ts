/**
 * Hasard reproductible : même graine, mêmes tirages. Le moteur n'utilise
 * jamais Math.random, pour qu'une partie contre la machine puisse être rejouée
 * à l'identique (revalidation par le serveur, tests).
 */

/** Générateur mulberry32 : rapide, 32 bits, suffisant pour du bruit de jeu. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mélange deux entiers en une graine (pour dériver une graine par coup). */
export function mixSeed(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = (h ^ Math.imul(b + 0x632be59b, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Tirage gaussien (Box-Muller) à partir d'un générateur uniforme. */
export function gaussian(random: () => number): number {
  let u = random();
  if (u < 1e-12) u = 1e-12;
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
