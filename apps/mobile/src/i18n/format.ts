/**
 * Formats selon la langue du joueur (SPEC §4) : nombres, cauris, dates, heures,
 * pendules et heures relatives. Module pur, testé par vitest.
 *
 * On passe par Intl quand il existe ; sinon (vieux moteur JS), un repli écrit à la main
 * donne le même résultat pour les nombres.
 */

/** Fonction de traduction minimale (compatible avec `TFunction` d'i18next). */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Séparateurs de repli, identiques à ceux d'Intl (espace fine insécable en français). */
const FALLBACK_SEPARATORS: Record<string, { group: string; decimal: string }> = {
  fr: { group: ' ', decimal: ',' },
  en: { group: ',', decimal: '.' },
};

const MINUS = '−'; // signe moins typographique, comme sur les planches (« −12 force »)

function baseLanguage(locale: string): string {
  return locale.toLowerCase().split(/[-_]/)[0] ?? 'fr';
}

/** Repli sans Intl : groupes de trois chiffres, `fractionDigits` décimales au plus. */
export function fallbackFormatNumber(value: number, locale: string, fractionDigits = 0): string {
  const sep = FALLBACK_SEPARATORS[baseLanguage(locale)] ?? FALLBACK_SEPARATORS.fr!;
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(fractionDigits);
  const [intPart = '0', rawDecimals = ''] = fixed.split('.');
  const decimals = rawDecimals.replace(/0+$/, '');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep.group);
  return `${negative ? '-' : ''}${grouped}${decimals ? sep.decimal + decimals : ''}`;
}

export function formatNumber(value: number, locale: string, maximumFractionDigits = 0): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
  } catch {
    return fallbackFormatNumber(value, locale, maximumFractionDigits);
  }
}

/** Montant de cauris, toujours entier : « 2 450 » (fr), « 2,450 » (en). */
export function formatCauris(amount: number, locale: string): string {
  return formatNumber(Math.trunc(amount), locale, 0);
}

/** Écart signé : « +200 », « −12 » (vrai signe moins), « 0 ». */
export function formatSigned(value: number, locale: string): string {
  const abs = formatNumber(Math.abs(Math.trunc(value)), locale, 0);
  if (value > 0) return `+${abs}`;
  if (value < 0) return `${MINUS}${abs}`;
  return abs;
}

/**
 * Pendule : temps restant arrondi à la seconde supérieure (on n'affiche 0:00
 * qu'une fois le temps réellement écoulé). « 3:48 », « 12:05 », « 1:02:03 ».
 */
export function formatClock(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export type DateStyle = 'time' | 'weekday' | 'dayTime' | 'short' | 'long' | 'dateTime';

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  time: { hour: 'numeric', minute: '2-digit' },
  weekday: { weekday: 'long' },
  dayTime: { weekday: 'long', hour: 'numeric', minute: '2-digit' },
  short: { day: 'numeric', month: 'short' },
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  dateTime: { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' },
};

/** Date ou heure selon la langue ; le fuseau est celui de l'appareil (sauf `timeZone`). */
export function formatDate(date: Date | number, locale: string, style: DateStyle, timeZone?: string): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  const options: Intl.DateTimeFormatOptions = timeZone ? { ...DATE_OPTIONS[style], timeZone } : DATE_OPTIONS[style];
  try {
    return new Intl.DateTimeFormat(locale, options).format(d);
  } catch {
    return d.toISOString().slice(0, style === 'time' ? 16 : 10).replace('T', ' ');
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Heure relative : « à l'instant », « il y a 2 min », « hier », « dans 2 h »…
 * Au-delà de 7 jours, la date courte. Les phrases viennent du catalogue `common:time`.
 */
export function formatRelative(
  date: Date | number,
  now: Date | number,
  t: Translate,
  locale: string,
  timeZone?: string,
): string {
  const at = typeof date === 'number' ? date : date.getTime();
  const ref = typeof now === 'number' ? now : now.getTime();
  const diff = ref - at;
  const past = diff >= 0;
  const abs = Math.abs(diff);

  if (abs < 45_000) return t('common:time.justNow');
  if (abs < HOUR) {
    const count = Math.max(1, Math.round(abs / MINUTE));
    if (count < 60) return t(past ? 'common:time.minutesAgo' : 'common:time.inMinutes', { count });
  }
  if (abs < DAY) {
    const count = Math.max(1, Math.round(abs / HOUR));
    if (count < 24) return t(past ? 'common:time.hoursAgo' : 'common:time.inHours', { count });
  }
  const days = Math.max(1, Math.round(abs / DAY));
  if (days === 1) return t(past ? 'common:time.yesterday' : 'common:time.tomorrow');
  if (days < 7) return t(past ? 'common:time.daysAgo' : 'common:time.inDays', { count: days });
  return formatDate(at, locale, 'short', timeZone);
}
