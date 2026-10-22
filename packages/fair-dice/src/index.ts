/**
 * Dé honnête et vérifiable (écran 22).
 *
 * 1. Avant la partie, le serveur tire un secret de 32 octets et publie son
 *    empreinte SHA-256 à tous les joueurs.
 * 2. À chaque lancer, le joueur qui touche le dé ajoute son grain de sel.
 *    Valeur = HMAC-SHA256(secret, partie ‖ 0x00 ‖ n° du lancer ‖ grain de sel),
 *    convertie en 1–6 par rejet (aucun biais de modulo).
 * 3. Après la partie, le secret est révélé : n'importe qui peut tout recalculer.
 *
 * Lancer de 6 cauris (Pachisi, écran 21c) : même HMAC, même message ; les
 * 6 bits de poids faible du premier octet donnent les 6 cauris (bit à 1 =
 * ouverture vers le ciel). 64 divise 256 : chaque cauri est un tirage à pile
 * ou face exact et indépendant des autres, sans rejet nécessaire.
 *
 * Ce module ne reçoit jamais l'état de la partie, le niveau, le solde ou les
 * résultats des joueurs : rien de tout cela ne peut influencer un lancer.
 * Pur JavaScript (@noble/hashes) : le même code tourne sur le serveur et dans l'appli.
 */
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

export const SEED_BYTES = 32;

/** Secret de partie, tiré par un générateur cryptographique. */
export function createServerSeed(): Uint8Array {
  const seed = new Uint8Array(SEED_BYTES);
  globalThis.crypto.getRandomValues(seed);
  return seed;
}

/** Grain de sel d'un joueur (16 octets suffisent). */
export function createClientSeed(): Uint8Array {
  const seed = new Uint8Array(16);
  globalThis.crypto.getRandomValues(seed);
  return seed;
}

/** Empreinte publiée avant la partie. */
export function commitment(serverSeed: Uint8Array): string {
  return bytesToHex(sha256(serverSeed));
}

export interface RollInput {
  serverSeed: Uint8Array;
  gameId: string;
  rollIndex: number;
  clientSeed: Uint8Array;
}

function message(gameId: string, rollIndex: number, clientSeed: Uint8Array, counter: number): Uint8Array {
  const id = utf8ToBytes(gameId);
  const out = new Uint8Array(id.length + 1 + 4 + 4 + clientSeed.length);
  const view = new DataView(out.buffer);
  out.set(id, 0);
  out[id.length] = 0;
  view.setUint32(id.length + 1, rollIndex);
  view.setUint32(id.length + 5, counter);
  out.set(clientSeed, id.length + 9);
  return out;
}

/** Tire uniformément un entier 1 … faces à partir du flux HMAC, par rejet. */
function uniform(input: RollInput, faces: number): number {
  if (!Number.isInteger(input.rollIndex) || input.rollIndex < 0) throw new Error('Numéro de lancer invalide');
  const limit = 256 - (256 % faces);
  for (let counter = 0; ; counter++) {
    const bytes = hmac(sha256, input.serverSeed, message(input.gameId, input.rollIndex, input.clientSeed, counter));
    for (const b of bytes) if (b < limit) return (b % faces) + 1;
  }
}

/** Valeur du dé (1 à 6). */
export function deriveRoll(input: RollInput): number {
  return uniform(input, 6);
}

/** Nombre de cauris lancés au Pachisi. */
export const COWRIE_COUNT = 6;

export interface CowrieThrow {
  /** Un booléen par cauri : vrai = ouverture vers le ciel. */
  shells: boolean[];
  /** Nombre d'ouvertures vers le ciel (0 à 6). La valeur en cases est une règle du jeu (@kwatt/rules-ludo). */
  up: number;
  /** Les 6 cauris sous forme de chaîne « 101100 » (cauri 1 en tête), pour la preuve publiée. */
  pattern: string;
}

/** Lancer de 6 cauris vérifiable : 6 bits sans biais du premier octet du HMAC. */
export function deriveCowries(input: RollInput): CowrieThrow {
  if (!Number.isInteger(input.rollIndex) || input.rollIndex < 0) throw new Error('Numéro de lancer invalide');
  const bytes = hmac(sha256, input.serverSeed, message(input.gameId, input.rollIndex, input.clientSeed, 0));
  const byte = bytes[0]!;
  const shells = Array.from({ length: COWRIE_COUNT }, (_, i) => ((byte >> i) & 1) === 1);
  return { shells, up: shells.filter(Boolean).length, pattern: shells.map((u) => (u ? '1' : '0')).join('') };
}

export interface PublishedRoll {
  rollIndex: number;
  clientSeed: string;
  /** Dé : la face (1 à 6). Cauris : le nombre d'ouvertures vers le ciel (0 à 6). */
  value: number;
  /** Cauris seulement (facultatif) : le détail « 101100 », vérifié s'il est publié. */
  pattern?: string;
}

export interface Verification {
  ok: boolean;
  commitmentMatches: boolean;
  mismatches: number[];
}

/** Ce que la partie lance : un dé à 6 faces (par défaut) ou 6 cauris (Pachisi). */
export type ThrowKind = 'die' | 'cowries';

/**
 * Vérification après la partie : ce que fait l'écran 22, et n'importe qui avec la preuve.
 * `kind` vaut 'die' par défaut (preuves déjà publiées compatibles).
 */
export function verifyGame(params: { gameId: string; commitment: string; serverSeed: string; rolls: PublishedRoll[]; kind?: ThrowKind }): Verification {
  const seed = hexToBytes(params.serverSeed);
  const commitmentMatches = commitment(seed) === params.commitment.toLowerCase();
  const kind = params.kind ?? 'die';
  const matches = (r: PublishedRoll): boolean => {
    const input = { serverSeed: seed, gameId: params.gameId, rollIndex: r.rollIndex, clientSeed: hexToBytes(r.clientSeed) };
    if (kind === 'die') return deriveRoll(input) === r.value;
    const t = deriveCowries(input);
    return t.up === r.value && (r.pattern === undefined || r.pattern === t.pattern);
  };
  const mismatches = params.rolls.filter((r) => !matches(r)).map((r) => r.rollIndex);
  return { ok: commitmentMatches && mismatches.length === 0, commitmentMatches, mismatches };
}

export { bytesToHex, hexToBytes };
