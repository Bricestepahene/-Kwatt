/** Calculs de recadrage de la photo de profil (module pur, testé par vitest). */

export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/** Plus grand carré centré dans une image de `width` × `height` pixels. */
export function squareCrop(width: number, height: number): CropRect {
  const side = Math.max(1, Math.floor(Math.min(width, height)));
  return {
    originX: Math.max(0, Math.floor((width - side) / 2)),
    originY: Math.max(0, Math.floor((height - side) / 2)),
    width: side,
    height: side,
  };
}
