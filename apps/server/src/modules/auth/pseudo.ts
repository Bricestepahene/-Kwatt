/**
 * Pseudo (SPEC §6) : 3 à 20 caractères [a-zA-Z0-9_.], unique sans tenir compte de la casse
 * (colonne citext), liste de mots interdits, 3 propositions quand il est pris.
 */
import { PSEUDO_MAX_LENGTH, isValidPseudoFormat } from '@kwatt/protocol';
import { randomInt } from 'node:crypto';
import type { Sql } from '../../db/pool.js';

/**
 * Mots refusés n'importe où dans le pseudo (après « l33t » → leet, séparateurs retirés).
 * Seulement des mots longs ou sans ambiguïté, pour ne pas bloquer des pseudos innocents.
 */
const BANNED_ANYWHERE = [
  // Réservés : personne ne doit pouvoir se faire passer pour l'équipe.
  'kwatt',
  'admin',
  'moderat',
  // Insultes et haine (français, anglais).
  'connard',
  'connasse',
  'salope',
  'encule',
  'batard',
  'niquer',
  'niquetamere',
  'fdp',
  'ntm',
  'tapette',
  'bougnoule',
  'youpin',
  'hitler',
  'pedophil',
  'fuck',
  'motherfuck',
  'bitch',
  'nigger',
  'nigga',
  'faggot',
  'whore',
  'rapist',
  'asshole',
  'dickhead',
];

/** Mots refusés seulement comme mot entier ou segment (entre « _ », « . » ou chiffres). */
const BANNED_SEGMENTS = [
  'con',
  'conne',
  'pute',
  'putain',
  'merde',
  'pd',
  'pede',
  'negre',
  'nazi',
  'pedo',
  'cunt',
  'slut',
  'retard',
  'dick',
  'cock',
  'pussy',
  'sex',
  'porn',
  'porno',
  'support',
  'staff',
  'root',
  'system',
  'systeme',
  'modo',
  'official',
  'officiel',
  'null',
  'undefined',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g' };

function deLeet(s: string): string {
  return s.replace(/[0-9]/g, (d) => LEET[d] ?? d);
}

/** true si le pseudo contient un mot interdit ou réservé. */
export function isBannedPseudo(pseudo: string): boolean {
  const lower = pseudo.toLowerCase();
  const compact = deLeet(lower).replace(/[_.]/g, '');
  if (BANNED_ANYWHERE.some((w) => compact.includes(w))) return true;
  const segments = new Set<string>([
    ...lower.split(/[_.0-9]+/),
    ...deLeet(lower).split(/[_.]+/),
    compact,
  ]);
  return BANNED_SEGMENTS.some((w) => segments.has(w));
}

export type PseudoProblem = 'invalid' | 'banned' | null;

export function checkPseudo(pseudo: string): PseudoProblem {
  if (!isValidPseudoFormat(pseudo)) return 'invalid';
  if (isBannedPseudo(pseudo)) return 'banned';
  return null;
}

export async function isPseudoTaken(db: Sql, pseudo: string, exceptUserId?: string): Promise<boolean> {
  const r = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM profiles WHERE pseudo = $1::citext AND ($2::uuid IS NULL OR user_id <> $2)',
    [pseudo, exceptUserId ?? null],
  );
  return (r.rows[0]?.n ?? 0) > 0;
}

/** Garde les caractères permis, pour proposer quelque chose à partir d'une saisie invalide. */
function sanitize(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_.]/g, '')
    .replace(/^[_.]+|[_.]+$/g, '');
}

/**
 * 3 propositions libres, proches de la saisie (« brice » → « brice_237 », « brice42 », « brice.817 »).
 * Rien n'est proposé pour un pseudo interdit.
 */
export async function suggestPseudos(db: Sql, raw: string, count = 3): Promise<string[]> {
  if (isBannedPseudo(raw)) return [];
  let base = sanitize(raw);
  if (base.length < 3) base = `${base}joueur`;
  base = base.slice(0, PSEUDO_MAX_LENGTH - 4);

  const out: string[] = [];
  for (let round = 0; round < 5 && out.length < count; round++) {
    const candidates = new Set<string>(
      (round === 0
        ? [`${base}_237`, `${base}${randomInt(10, 100)}`, `${base}.${randomInt(100, 1000)}`, `${base}_cm`, `le_${base}`]
        : Array.from({ length: 6 }, () => `${base}${randomInt(100, 10_000)}`)
      )
        .map((c) => c.slice(0, PSEUDO_MAX_LENGTH))
        .filter((c) => checkPseudo(c) === null && !out.includes(c)),
    );
    if (candidates.size === 0) continue;
    const taken = await db.query<{ pseudo: string }>('SELECT pseudo::text AS pseudo FROM profiles WHERE pseudo = ANY($1::citext[])', [
      [...candidates],
    ]);
    const takenLower = new Set(taken.rows.map((r) => r.pseudo.toLowerCase()));
    for (const c of candidates) {
      if (out.length < count && !takenLower.has(c.toLowerCase())) out.push(c);
    }
  }
  return out;
}
