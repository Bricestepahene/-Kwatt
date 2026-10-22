/**
 * Représentation interne rapide pour la recherche : damier mutable, coups
 * joués et défaits sur place, clés de Zobrist incrémentales.
 *
 * Les règles sont celles de @kwatt/rules-dames, recopiées à l'identique pour
 * la vitesse (pas d'objet par position, pas de copie du damier) : un test
 * compare les coups légaux des deux générateurs sur des milliers de positions.
 * Les coups rendus à l'extérieur du moteur sont toujours revalidés par
 * `findLegal` de @kwatt/rules-dames.
 */
import { RULES, toCoord, toSquare, type DamesState, type Move as RulesMove, type Piece, type Side, type Variant } from '@kwatt/rules-dames';
import { mulberry32 } from './random.js';

/** Pièces : pion blanc 1, dame blanche 2, pion noir −1, dame noire −2, vide 0. */
export const WM = 1;
export const WK = 2;
export const BM = -1;
export const BK = -2;

/** Camp : 1 blancs, −1 noirs. */
export type Color = 1 | -1;

/** Géométrie et règles d'une variante, précalculées une fois. */
export interface Geo {
  variant: Variant;
  size: number;
  /** Nombre de cases jouables (50 ou 32). */
  n: number;
  /** rays[case][direction] : cases rencontrées (numérotation officielle, à partir de 1). */
  rays: number[][][];
  /** Ligne (0 en haut) et colonne de chaque case. */
  row: Int8Array;
  col: Int8Array;
  flying: boolean;
  menCaptureBackward: boolean;
  majority: boolean;
  promotionStopsCapture: boolean;
  quietLimit: number;
  repetitionLimit: number;
  /** Directions vers l'avant : index 0 = blancs, 1 = noirs. */
  forward: [number[], number[]];
  /** Ligne de promotion : index 0 = blancs, 1 = noirs. */
  promoRow: [number, number];
  firstToMove: Color;
  /** Clés de Zobrist : [case × 4 + type] pour deux mots de 32 bits. */
  z1: Uint32Array;
  z2: Uint32Array;
  side1: number;
  side2: number;
}

const DIRS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

const geoCache = new Map<Variant, Geo>();

export function geometry(variant: Variant): Geo {
  const cached = geoCache.get(variant);
  if (cached) return cached;
  const rules = RULES[variant];
  const g = rules.geometry;
  const n = g.squares;
  const rays: number[][][] = [[]];
  const row = new Int8Array(n + 1);
  const col = new Int8Array(n + 1);
  for (let s = 1; s <= n; s++) {
    const c = toCoord(g, s);
    row[s] = c.row;
    col[s] = c.col;
    rays.push(
      DIRS.map(([dr, dc]) => {
        const ray: number[] = [];
        let r = c.row + dr;
        let k = c.col + dc;
        let sq = toSquare(g, r, k);
        while (sq !== null) {
          ray.push(sq);
          r += dr;
          k += dc;
          sq = toSquare(g, r, k);
        }
        return ray;
      }),
    );
  }
  // Le camp du haut descend (directions 2 et 3) et se promeut sur la dernière ligne.
  const whiteDown = rules.topSide === 'w';
  const forward: [number[], number[]] = whiteDown ? [[2, 3], [0, 1]] : [[0, 1], [2, 3]];
  const promoRow: [number, number] = whiteDown ? [g.size - 1, 0] : [0, g.size - 1];
  // Clés fixes (graine constante) : le même hachage partout, serveur et appli.
  const random = mulberry32(variant === 'dames10' ? 0x5eed10 : 0x5eed08);
  const z1 = new Uint32Array((n + 1) * 4);
  const z2 = new Uint32Array((n + 1) * 4);
  for (let i = 0; i < z1.length; i++) {
    z1[i] = Math.floor(random() * 4294967296);
    z2[i] = Math.floor(random() * 4294967296);
  }
  const geo: Geo = {
    variant,
    size: g.size,
    n,
    rays,
    row,
    col,
    flying: rules.flyingKings,
    menCaptureBackward: rules.menCaptureBackward,
    majority: rules.majorityCapture,
    promotionStopsCapture: rules.promotionStopsCapture,
    quietLimit: rules.quietKingPliesLimit,
    repetitionLimit: rules.repetitionLimit,
    forward,
    promoRow,
    firstToMove: rules.firstToMove === 'w' ? 1 : -1,
    z1,
    z2,
    side1: Math.floor(random() * 4294967296),
    side2: Math.floor(random() * 4294967296),
  };
  geoCache.set(variant, geo);
  return geo;
}

/** Index de type de pièce pour les clés : pion blanc 0, dame blanche 1, pion noir 2, dame noire 3. */
function typeIndex(p: number): number {
  return p === WM ? 0 : p === WK ? 1 : p === BM ? 2 : 3;
}

/** Coup interne : cases de passage (départ et arrivée compris) et pièces prises. */
export interface EMove {
  from: number;
  to: number;
  path: number[];
  caps: number[];
}

/** Clé d'identité, identique à `moveKey` de rules-dames. */
export function emoveKey(m: { from: number; to: number; caps?: number[]; captures?: number[] }): string {
  const caps = m.caps ?? m.captures ?? [];
  return `${m.from}-${m.to}:${[...caps].sort((a, b) => a - b).join(',')}`;
}

/** Notation officielle : « 32-28 » ou « 28x19x10 ». */
export function emoveNotation(m: EMove): string {
  return m.caps.length ? m.path.join('x') : `${m.from}-${m.to}`;
}

export function toRulesMove(m: EMove): RulesMove {
  return { from: m.from, to: m.to, path: [...m.path], captures: [...m.caps] };
}

interface Undo {
  move: EMove;
  piece: number;
  captured: number[];
  quiet: number;
  h1: number;
  h2: number;
  irrev: number;
}

const pieceCode = (p: Piece): number => (p === 'w' ? WM : p === 'W' ? WK : p === 'b' ? BM : p === 'B' ? BK : 0);
const pieceChar = (v: number): Piece => (v === WM ? 'w' : v === WK ? 'W' : v === BM ? 'b' : v === BK ? 'B' : '');

/** Position mutable. */
export class Position {
  readonly g: Geo;
  readonly b: Int8Array;
  stm: Color;
  h1 = 0;
  h2 = 0;
  /** Demi-coups de dames sans prise (nulle à `quietLimit`). */
  quiet = 0;
  /** Nombre de pièces : pions blancs, dames blanches, pions noirs, dames noires. */
  wm = 0;
  wk = 0;
  bm = 0;
  bk = 0;
  /** Hachages des positions depuis le dernier coup irréversible (répétitions). */
  private readonly rep1: number[] = [];
  private readonly rep2: number[] = [];
  private lastIrrev = 0;
  private readonly undos: Undo[] = [];
  /** Tampons du générateur de prises. */
  private readonly taken: Uint8Array;
  private readonly pathBuf: number[] = [];
  private readonly capsBuf: number[] = [];

  constructor(variant: Variant, board: ArrayLike<number>, stm: Color) {
    this.g = geometry(variant);
    if (board.length !== this.g.n + 1) throw new Error('Taille de damier invalide');
    this.b = Int8Array.from(board);
    this.b[0] = 0;
    this.stm = stm;
    this.taken = new Uint8Array(this.g.n + 1);
    this.recount();
    this.rep1.push(this.h1);
    this.rep2.push(this.h2);
  }

  /** Construit la position d'un état de rules-dames (avec ses positions déjà vues). */
  static fromState(state: DamesState): Position {
    const g = geometry(state.variant);
    const board = new Int8Array(g.n + 1);
    state.board.forEach((p, i) => (board[i + 1] = pieceCode(p)));
    const pos = new Position(state.variant, board, state.turn === 'w' ? 1 : -1);
    pos.quiet = state.quietKingPlies;
    // Positions déjà vues depuis le dernier coup irréversible (répétition).
    const current = `${state.turn}:`;
    for (const key of Object.keys(state.seen)) {
      const [h1, h2] = hashOfKey(g, key);
      if (h1 === pos.h1 && h2 === pos.h2 && key.startsWith(current)) continue;
      pos.rep1.unshift(h1);
      pos.rep2.unshift(h2);
    }
    return pos;
  }

  /** État rules-dames équivalent (sans l'historique des répétitions). */
  toBoard(): Piece[] {
    const out: Piece[] = [];
    for (let s = 1; s <= this.g.n; s++) out.push(pieceChar(this.b[s]!));
    return out;
  }

  get side(): Side {
    return this.stm === 1 ? 'w' : 'b';
  }

  clone(): Position {
    const p = new Position(this.g.variant, this.b, this.stm);
    p.quiet = this.quiet;
    return p;
  }

  /** Recalcule hachage et compteurs depuis le damier. */
  recount(): void {
    const { g, b } = this;
    let h1 = 0;
    let h2 = 0;
    this.wm = this.wk = this.bm = this.bk = 0;
    for (let s = 1; s <= g.n; s++) {
      const p = b[s]!;
      if (p === 0) continue;
      const k = s * 4 + typeIndex(p);
      h1 ^= g.z1[k]!;
      h2 ^= g.z2[k]!;
      if (p === WM) this.wm++;
      else if (p === WK) this.wk++;
      else if (p === BM) this.bm++;
      else this.bk++;
    }
    if (this.stm === -1) {
      h1 ^= g.side1;
      h2 ^= g.side2;
    }
    this.h1 = h1 >>> 0;
    this.h2 = h2 >>> 0;
  }

  /** Nombre de pièces d'un camp. */
  count(c: Color): number {
    return c === 1 ? this.wm + this.wk : this.bm + this.bk;
  }

  /** Coups légaux (prise obligatoire, majoritaire en 10×10), sans doublon. */
  legalMoves(): EMove[] {
    const out: EMove[] = [];
    this.genCaptures(out);
    if (out.length > 0) return out;
    this.genQuiet(out);
    return out;
  }

  /** Prises seulement (vide si aucune prise n'est possible). */
  genCaptures(out: EMove[]): void {
    const { b, g, stm } = this;
    const start = out.length;
    for (let s = 1; s <= g.n; s++) {
      const p = b[s]!;
      if (p * stm > 0) this.capturesFrom(s, out);
    }
    if (out.length === start) return;
    let list = out.splice(start);
    if (g.majority) {
      let max = 0;
      for (const m of list) if (m.caps.length > max) max = m.caps.length;
      list = list.filter((m) => m.caps.length === max);
    }
    // Deux chemins qui prennent les mêmes pièces sont le même coup.
    if (list.length > 1) {
      const seen = new Set<string>();
      for (const m of list) {
        const k = emoveKey(m);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(m);
        }
      }
    } else {
      out.push(...list);
    }
  }

  private capturesFrom(from: number, out: EMove[]): void {
    const { b, g, taken } = this;
    const piece = b[from]!;
    const side: Color = piece > 0 ? 1 : -1;
    const king = piece === WK || piece === BK;
    const flying = king && g.flying;
    const dirs = king || g.menCaptureBackward ? [0, 1, 2, 3] : g.forward[side === 1 ? 0 : 1];
    const promoRow = g.promoRow[side === 1 ? 0 : 1];
    const stops = !king && g.promotionStopsCapture;
    const path = this.pathBuf;
    const caps = this.capsBuf;
    path.length = 0;
    caps.length = 0;
    path.push(from);
    // La pièce qui joue quitte sa case : elle peut repasser par son point de départ.
    b[from] = 0;
    const explore = (at: number): void => {
      let extended = false;
      if (!(stops && caps.length > 0 && g.row[at] === promoRow)) {
        const rays = g.rays[at]!;
        for (const d of dirs) {
          const ray = rays[d]!;
          let i = 0;
          if (flying) while (i < ray.length && b[ray[i]!] === 0) i++;
          if (i >= ray.length) continue;
          const victim = ray[i]!;
          if (b[victim]! * side >= 0 || taken[victim]) continue;
          for (let j = i + 1; j < ray.length; j++) {
            const land = ray[j]!;
            if (b[land] !== 0) break;
            extended = true;
            taken[victim] = 1;
            path.push(land);
            caps.push(victim);
            explore(land);
            caps.pop();
            path.pop();
            taken[victim] = 0;
            if (!flying) break;
          }
        }
      }
      if (!extended && caps.length > 0) out.push({ from, to: at, path: path.slice(), caps: caps.slice() });
    };
    explore(from);
    b[from] = piece;
  }

  /** Toutes les prises, sans le filtre de la prise majoritaire (pour les quiz de règle). */
  allCaptures(): EMove[] {
    const out: EMove[] = [];
    for (let s = 1; s <= this.g.n; s++) if (this.b[s]! * this.stm > 0) this.capturesFrom(s, out);
    const seen = new Set<string>();
    return out.filter((m) => {
      const k = emoveKey(m);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** Coups sans prise. */
  genQuiet(out: EMove[]): void {
    const { b, g, stm } = this;
    const fwd = g.forward[stm === 1 ? 0 : 1];
    for (let s = 1; s <= g.n; s++) {
      const p = b[s]!;
      if (p * stm <= 0) continue;
      const rays = g.rays[s]!;
      if (p === WM || p === BM) {
        for (const d of fwd) {
          const to = rays[d]![0];
          if (to !== undefined && b[to] === 0) out.push({ from: s, to, path: [s, to], caps: [] });
        }
      } else {
        for (let d = 0; d < 4; d++) {
          const ray = rays[d]!;
          for (let j = 0; j < ray.length; j++) {
            const to = ray[j]!;
            if (b[to] !== 0) break;
            out.push({ from: s, to, path: [s, to], caps: [] });
            if (!g.flying) break;
          }
        }
      }
    }
  }

  /** Le camp au trait a-t-il une prise ? (plus rapide que de générer les coups). */
  hasCapture(): boolean {
    const { b, g, stm } = this;
    for (let s = 1; s <= g.n; s++) {
      const p = b[s]!;
      if (p * stm <= 0) continue;
      const king = p === WK || p === BK;
      const flying = king && g.flying;
      const dirs = king || g.menCaptureBackward ? [0, 1, 2, 3] : g.forward[stm === 1 ? 0 : 1];
      const rays = g.rays[s]!;
      for (const d of dirs) {
        const ray = rays[d]!;
        let i = 0;
        if (flying) while (i < ray.length && b[ray[i]!] === 0) i++;
        if (i + 1 >= ray.length) continue;
        if (b[ray[i]!]! * stm < 0 && b[ray[i + 1]!] === 0) return true;
      }
    }
    return false;
  }

  /** Le camp au trait a-t-il au moins un coup sans prise ? */
  hasQuietMove(): boolean {
    const { b, g, stm } = this;
    const fwd = g.forward[stm === 1 ? 0 : 1];
    for (let s = 1; s <= g.n; s++) {
      const p = b[s]!;
      if (p * stm <= 0) continue;
      const rays = g.rays[s]!;
      const dirs = p === WM || p === BM ? fwd : [0, 1, 2, 3];
      for (const d of dirs) {
        const to = rays[d]![0];
        if (to !== undefined && b[to] === 0) return true;
      }
    }
    return false;
  }

  /** Joue un coup (supposé légal). */
  make(m: EMove): void {
    const { b, g } = this;
    const piece = b[m.from]!;
    const captured: number[] = [];
    let h1 = this.h1;
    let h2 = this.h2;
    let k = m.from * 4 + typeIndex(piece);
    h1 ^= g.z1[k]!;
    h2 ^= g.z2[k]!;
    b[m.from] = 0;
    for (const c of m.caps) {
      const v = b[c]!;
      captured.push(v);
      k = c * 4 + typeIndex(v);
      h1 ^= g.z1[k]!;
      h2 ^= g.z2[k]!;
      b[c] = 0;
      if (v === WM) this.wm--;
      else if (v === WK) this.wk--;
      else if (v === BM) this.bm--;
      else this.bk--;
    }
    const isMan = piece === WM || piece === BM;
    const side = piece > 0 ? 0 : 1;
    const promotes = isMan && g.row[m.to] === g.promoRow[side];
    const placed = promotes ? piece * 2 : piece;
    if (promotes) {
      if (piece === WM) {
        this.wm--;
        this.wk++;
      } else {
        this.bm--;
        this.bk++;
      }
    }
    b[m.to] = placed;
    k = m.to * 4 + typeIndex(placed);
    h1 ^= g.z1[k]!;
    h2 ^= g.z2[k]!;
    h1 ^= g.side1;
    h2 ^= g.side2;
    this.undos.push({ move: m, piece, captured, quiet: this.quiet, h1: this.h1, h2: this.h2, irrev: this.lastIrrev });
    const kingQuiet = !isMan && m.caps.length === 0;
    this.quiet = kingQuiet ? this.quiet + 1 : 0;
    this.h1 = h1 >>> 0;
    this.h2 = h2 >>> 0;
    this.stm = this.stm === 1 ? -1 : 1;
    if (!kingQuiet) this.lastIrrev = this.rep1.length;
    this.rep1.push(this.h1);
    this.rep2.push(this.h2);
  }

  /** Défait le dernier coup joué. */
  unmake(): void {
    const u = this.undos.pop();
    if (!u) throw new Error('Aucun coup à défaire');
    const { b } = this;
    const m = u.move;
    const placed = b[m.to]!;
    b[m.to] = 0;
    if (placed !== u.piece) {
      if (u.piece === WM) {
        this.wm++;
        this.wk--;
      } else {
        this.bm++;
        this.bk--;
      }
    }
    b[m.from] = u.piece;
    m.caps.forEach((c, i) => {
      const v = u.captured[i]!;
      b[c] = v;
      if (v === WM) this.wm++;
      else if (v === WK) this.wk++;
      else if (v === BM) this.bm++;
      else this.bk++;
    });
    this.quiet = u.quiet;
    this.h1 = u.h1;
    this.h2 = u.h2;
    this.stm = this.stm === 1 ? -1 : 1;
    this.lastIrrev = u.irrev;
    this.rep1.pop();
    this.rep2.pop();
  }

  /** Nombre de coups joués depuis la création (profondeur dans la recherche). */
  get depthPlayed(): number {
    return this.undos.length;
  }

  /** La position courante est-elle déjà apparue depuis le dernier coup irréversible ? */
  isRepetition(): boolean {
    const n = this.rep1.length - 1;
    for (let i = n - 1; i >= this.lastIrrev; i--) {
      if (this.rep1[i] === this.h1 && this.rep2[i] === this.h2) return true;
    }
    return false;
  }

  /** Nulle par la règle des coups de dames (25 de chaque côté en 10×10). */
  isQuietDraw(): boolean {
    return this.quiet >= this.g.quietLimit;
  }
}

/** Hachage d'une clé de position de rules-dames (« w:..wb.. »). */
export function hashOfKey(g: Geo, key: string): [number, number] {
  const turn = key[0];
  let h1 = 0;
  let h2 = 0;
  for (let s = 1; s <= g.n; s++) {
    const ch = key[s + 1];
    const v = ch === 'w' ? WM : ch === 'W' ? WK : ch === 'b' ? BM : ch === 'B' ? BK : 0;
    if (v === 0) continue;
    const k = s * 4 + typeIndex(v);
    h1 ^= g.z1[k]!;
    h2 ^= g.z2[k]!;
  }
  if (turn === 'b') {
    h1 ^= g.side1;
    h2 ^= g.side2;
  }
  return [h1 >>> 0, h2 >>> 0];
}

/** Position de départ d'une variante. */
export function initialPosition(variant: Variant): Position {
  const g = geometry(variant);
  const rules = RULES[variant];
  const perRow = g.size / 2;
  const rows = rules.geometry.startRows;
  const board = new Int8Array(g.n + 1);
  const top = rules.topSide === 'w' ? WM : BM;
  for (let s = 1; s <= rows * perRow; s++) board[s] = top;
  for (let s = g.n - rows * perRow + 1; s <= g.n; s++) board[s] = -top;
  return new Position(variant, board, g.firstToMove);
}
