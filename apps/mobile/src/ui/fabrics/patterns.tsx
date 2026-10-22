/**
 * Les quatre tissus de la planche « Réf · Identité », dessinés en SVG (jamais en image) :
 * ndop (Grassfields : fonds, en-têtes, cartes communes), toghu (Nord-Ouest : cartes rares,
 * trophées, victoire), kaba ngondo (Littoral : Ludo, fêtes) et obom (Est : plateaux, bois).
 * La géométrie reprend les motifs CSS des planches (`fabricPatterns` de @kwatt/design).
 */
import { fabricPatterns, type FabricName } from '@kwatt/design';
import { Circle, Path, Pattern, Rect } from 'react-native-svg';

export type { FabricName };
export const FABRICS: readonly FabricName[] = ['ndop', 'toghu', 'kaba', 'obom'];

/** Identifiant SVG sûr à partir de `useId()` (les « : » ou « « » gênent `url(#…)`). */
export function svgId(raw: string, prefix: string): string {
  return `${prefix}${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/**
 * Motif(s) du tissu, à placer dans `<Defs>`. Le tissu se peint avec
 * `fill={\`url(#${id})\`}` ; l'obom a deux couches (`${id}` puis `${id}-b`).
 * `scale` agrandit le motif (icônes, grands aplats).
 */
export function FabricDefs({ name, id, scale = 1 }: { name: FabricName; id: string; scale?: number }) {
  switch (name) {
    case 'ndop': {
      const { tile, base, motif } = fabricPatterns.ndop;
      const s = tile * scale;
      const h = s / 2;
      return (
        <Pattern id={id} width={s} height={s} patternUnits="userSpaceOnUse">
          <Rect width={s} height={s} fill={base} />
          <Path d={`M0 0 L${s} 0 L${h} ${h} Z M0 ${s} L0 ${h} L${h} ${s} Z M${s} ${s} L${h} ${s} L${s} ${h} Z`} fill={motif} />
        </Pattern>
      );
    }
    case 'toghu': {
      const { tile, base, small, large } = fabricPatterns.toghu;
      const s = tile * scale;
      const r = large.radius * scale;
      return (
        <Pattern id={id} width={s} height={s} patternUnits="userSpaceOnUse">
          <Rect width={s} height={s} fill={base} />
          <Circle cx={s / 2} cy={s / 2} r={small.radius * scale} fill={small.color} />
          <Circle cx={0} cy={0} r={r} fill={large.color} />
          <Circle cx={s} cy={0} r={r} fill={large.color} />
          <Circle cx={0} cy={s} r={r} fill={large.color} />
          <Circle cx={s} cy={s} r={r} fill={large.color} />
        </Pattern>
      );
    }
    case 'kaba': {
      const { stripes } = fabricPatterns.kaba;
      const period = stripes.reduce((sum, stripe) => sum + stripe.width, 0) * scale;
      let x = 0;
      return (
        <Pattern id={id} width={period} height={period} patternUnits="userSpaceOnUse">
          {stripes.map((stripe) => {
            const rect = <Rect key={`${stripe.color}-${x}`} x={x} y={0} width={stripe.width * scale} height={period} fill={stripe.color} />;
            x += stripe.width * scale;
            return rect;
          })}
        </Pattern>
      );
    }
    case 'obom': {
      const { base, grains } = fabricPatterns.obom;
      return (
        <>
          {grains.map((grain, index) => {
            const period = grain.period * scale;
            return (
              <Pattern
                key={grain.color}
                id={index === 0 ? id : `${id}-b`}
                width={period * 4}
                height={period}
                patternUnits="userSpaceOnUse"
                patternTransform={`rotate(${grain.angle})`}
              >
                {index === 0 ? <Rect width={period * 4} height={period} fill={base} /> : null}
                <Rect width={period * 4} height={grain.width * scale} fill={grain.color} />
              </Pattern>
            );
          })}
        </>
      );
    }
  }
}

/** Calques à peindre pour remplir une forme avec le tissu (un seul, sauf l'obom). */
export function fabricFills(name: FabricName, id: string): string[] {
  return name === 'obom' ? [`url(#${id})`, `url(#${id}-b)`] : [`url(#${id})`];
}
