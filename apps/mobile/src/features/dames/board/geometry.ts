/**
 * Géométrie du damier à l'écran (module pur) : case ↔ ligne/colonne affichées (plateau
 * retourné quand on joue les noirs), taille des cases, contenu annoncé aux lecteurs d'écran.
 */
import { GEOMETRY_10, GEOMETRY_8, toCoord, toSquare, type Geometry, type Piece, type Variant } from '@kwatt/rules-dames';

/** Cases de damier : au moins 34 px (SPEC §5). */
export const MIN_CELL = 34;
/** Cadre en bois autour du damier (planche : 5 px, 10 px sur tablette). */
export function framePadding(boardSize: number): number {
  return boardSize >= 600 ? 10 : boardSize >= 340 ? 5 : 4;
}

export function geometryOf(variant: Variant): Geometry {
  return variant === 'dames8' ? GEOMETRY_8 : GEOMETRY_10;
}

/** Ligne et colonne affichées d'une case (0, 0 en haut à gauche de l'écran). */
export function cellOf(variant: Variant, square: number, flipped: boolean): { row: number; col: number } {
  const g = geometryOf(variant);
  const { row, col } = toCoord(g, square);
  return flipped ? { row: g.size - 1 - row, col: g.size - 1 - col } : { row, col };
}

/** Case jouable sous une ligne/colonne affichée (null : case claire). */
export function squareAt(variant: Variant, row: number, col: number, flipped: boolean): number | null {
  const g = geometryOf(variant);
  return flipped ? toSquare(g, g.size - 1 - row, g.size - 1 - col) : toSquare(g, row, col);
}

/** Taille des cases pour un damier qui tient dans `available` px (cadre compris), jamais sous 34 px. */
export function cellSize(variant: Variant, available: number): number {
  const g = geometryOf(variant);
  const pad = framePadding(available);
  return Math.max(MIN_CELL, Math.floor((available - 2 * pad) / g.size));
}

export type PieceDescription = 'empty' | 'whiteMan' | 'whiteKing' | 'blackMan' | 'blackKing';

export function describePiece(p: Piece | undefined): PieceDescription {
  switch (p) {
    case 'w':
      return 'whiteMan';
    case 'W':
      return 'whiteKing';
    case 'b':
      return 'blackMan';
    case 'B':
      return 'blackKing';
    default:
      return 'empty';
  }
}

/** Pions et dames restants d'un camp (« 9 pions · 1 dame »). */
export function material(board: readonly Piece[], side: 'w' | 'b'): { men: number; kings: number } {
  let men = 0;
  let kings = 0;
  for (const p of board) {
    if (p === side) men++;
    else if (p === side.toUpperCase()) kings++;
  }
  return { men, kings };
}
