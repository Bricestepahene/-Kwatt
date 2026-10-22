/**
 * Journal des cauris (« Mouvement » de la planche Système : qui, combien, pourquoi, partie
 * liée), lu sur GET /v1/wallet/journal. Ce module range les mouvements par jour et en tire
 * ce qu'il faut afficher ; les textes viennent du catalogue `profile` (journal.kind.*).
 * Module pur, testé par vitest.
 */
import { JournalMetaSchema, LEDGER_KINDS, type JournalEntry, type JournalMeta } from '@kwatt/protocol';

const KNOWN_KINDS: ReadonlySet<string> = new Set(LEDGER_KINDS);

/** Clé de traduction du motif (`journal.kind.<kind>`), « other » pour un motif inconnu. */
export function journalKindKey(kind: string): string {
  return KNOWN_KINDS.has(kind) ? kind : 'other';
}

/** Détail lisible d'un mouvement : l'objet acheté, l'adversaire, la ligue… (ou rien). */
export type JournalDetail =
  | { kind: 'item'; code: string; serial: number | null }
  | { kind: 'opponent'; name: string }
  | { kind: 'opponents'; names: string[] }
  | { kind: 'league'; name: string }
  | { kind: 'quest'; code: string };

const fields = JournalMetaSchema.shape;

/** Lit un champ de `meta` selon la convention de @kwatt/protocol (un champ mal formé est ignoré). */
function field<K extends keyof JournalMeta>(meta: Record<string, unknown>, key: K): JournalMeta[K] | undefined {
  const schema: { safeParse(value: unknown): { success: boolean; data?: unknown } } = fields[key];
  const r = schema.safeParse(meta[key]);
  return r.success ? (r.data as JournalMeta[K]) : undefined;
}

export function journalDetail(entry: Pick<JournalEntry, 'meta'>): JournalDetail | null {
  const meta = entry.meta ?? {};
  const itemCode = field(meta, 'itemCode');
  if (itemCode) return { kind: 'item', code: itemCode, serial: field(meta, 'serial') ?? null };
  const opponent = field(meta, 'opponent');
  if (opponent?.pseudo) return { kind: 'opponent', name: opponent.pseudo };
  const opponents = field(meta, 'opponents');
  if (opponents && opponents.length > 0) return { kind: 'opponents', names: opponents };
  const league = field(meta, 'leagueName');
  if (league) return { kind: 'league', name: league };
  const quest = field(meta, 'quest');
  if (quest) return { kind: 'quest', code: quest };
  return null;
}

/** Jour local (fuseau de l'appareil) d'une date : « 2026-10-22 ». */
export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface JournalDay<T> {
  /** « today », « yesterday » ou le jour (AAAA-MM-JJ). */
  label: 'today' | 'yesterday' | 'date';
  dayKey: string;
  /** Premier instant du groupe, pour formater la date. */
  date: Date;
  items: T[];
}

/** Regroupe les mouvements (du plus récent au plus ancien) par jour : Aujourd'hui, Hier, puis la date. */
export function groupByDay<T extends Pick<JournalEntry, 'createdAt'>>(entries: readonly T[], now: Date): JournalDay<T>[] {
  const today = localDayKey(now);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const yesterday = localDayKey(y);
  const days: JournalDay<T>[] = [];
  for (const entry of entries) {
    const date = new Date(entry.createdAt);
    const key = localDayKey(date);
    let day = days[days.length - 1];
    if (!day || day.dayKey !== key) {
      day = { label: key === today ? 'today' : key === yesterday ? 'yesterday' : 'date', dayKey: key, date, items: [] };
      days.push(day);
    }
    day.items.push(entry);
  }
  return days;
}

/** Ton du montant : gain (vert) ou dépense (corail). */
export function amountTone(amount: number): 'gain' | 'alert' {
  return amount >= 0 ? 'gain' : 'alert';
}
