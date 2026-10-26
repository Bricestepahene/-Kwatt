/**
 * Générateur pseudo-aléatoire à graine (sfc32) : la machine tire ses
 * simulations et ses petites hésitations avec lui, jamais avec Math.random.
 * Ce n'est PAS le dé de la partie : le dé vient du tirage vérifiable du
 * serveur, que ce paquet n'importe jamais.
 */
export interface Rng {
  /** Réel uniforme dans [0, 1). */
  next(): number;
  /** Entier uniforme dans [0, n). */
  int(n: number): number;
}

export function createRng(seed: number): Rng {
  // Graine étalée sur 4 mots de 32 bits (splitmix32).
  let s = seed >>> 0;
  const split = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
  let a = split();
  let b = split();
  let c = split();
  let d = split();
  const next = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  // Quelques tours à vide pour bien mélanger.
  for (let i = 0; i < 12; i++) next();
  return { next, int: (n) => Math.floor(next() * n) };
}

/** Empreinte 32 bits d'une suite de nombres (graine par défaut tirée de la position). */
export function hashNumbers(values: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    h ^= v & 0xffff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xffff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Tirage d'une valeur selon une loi discrète ({ value, p }, somme 1). */
export function sample(dist: readonly { value: number; p: number }[], rng: Rng): number {
  let u = rng.next();
  for (const { value, p } of dist) {
    if (u < p) return value;
    u -= p;
  }
  return dist[dist.length - 1]!.value;
}
