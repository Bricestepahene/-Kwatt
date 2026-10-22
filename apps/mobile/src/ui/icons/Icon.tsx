/**
 * Icônes en traits (24 × 24, trait de 2, bouts arrondis), reprises des planches quand
 * elles y figurent (retour, cloche, barre du bas, amis, réglages, cadenas, machine,
 * code, aide), dessinées dans le même style pour les autres.
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../../theme';

type Shape =
  | { d: string }
  | { circle: [cx: number, cy: number, r: number] }
  | { rect: [x: number, y: number, w: number, h: number, rx: number] };

const ICONS = {
  // --- planches
  back: [{ d: 'M15 5l-7 7 7 7' }],
  bell: [{ d: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4z' }, { d: 'M10 21h4' }],
  home: [{ d: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z' }],
  play: [{ circle: [12, 6, 3] }, { d: 'M8.5 20h7l-1.5-9h-4z' }, { d: 'M6 20h12' }],
  trophy: [{ d: 'M7 4h10v5a5 5 0 0 1-10 0z' }, { d: 'M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8' }],
  cards: [{ rect: [4, 6, 12, 15, 2] }, { d: 'M8 3h10a2 2 0 0 1 2 2v13' }],
  profile: [{ circle: [12, 8, 4] }, { d: 'M4 21a8 8 0 0 1 16 0' }],
  friends: [{ circle: [9, 8, 3] }, { circle: [17, 9, 2.5] }, { d: 'M3 20a6 6 0 0 1 12 0M15 20a4 4 0 0 1 6-3.5' }],
  settings: [
    { circle: [12, 12, 3] },
    { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1' },
  ],
  lock: [{ rect: [5, 11, 14, 10, 2] }, { d: 'M8 11V8a4 4 0 0 1 8 0v3' }],
  machine: [{ rect: [5, 7, 14, 11, 3] }, { d: 'M12 3v4M9 12h.01M15 12h.01M9 21h6' }],
  keypad: [{ rect: [3, 6, 18, 12, 3] }, { d: 'M7 12h.01M11 12h.01M15 12h.01' }],
  help: [{ circle: [12, 12, 9] }, { d: 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01' }],
  // --- même style
  close: [{ d: 'M6 6l12 12M18 6L6 18' }],
  check: [{ d: 'M5 12.5l4.5 4.5L19 7' }],
  plus: [{ d: 'M12 5v14M5 12h14' }],
  minus: [{ d: 'M5 12h14' }],
  chevronRight: [{ d: 'M9 5l7 7-7 7' }],
  chevronDown: [{ d: 'M5 9l7 7 7-7' }],
  eye: [{ d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z' }, { circle: [12, 12, 3] }],
  eyeOff: [
    { d: 'M3 3l18 18' },
    { d: 'M10.6 5.1A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3' },
    { d: 'M9.9 9.9a3 3 0 0 0 4.2 4.2' },
  ],
  share: [{ circle: [18, 5, 3] }, { circle: [6, 12, 3] }, { circle: [18, 19, 3] }, { d: 'M8.6 13.5l6.8 4M15.4 6.5l-6.8 4' }],
  copy: [{ rect: [9, 9, 12, 12, 2] }, { d: 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1' }],
  wifiOff: [
    { d: 'M2 8.5a16 16 0 0 1 4.2-2.6M9.8 5.2A16 16 0 0 1 22 8.5M5 12a11 11 0 0 1 5.2-2.7M16.5 10.6A11 11 0 0 1 19 12M8.5 15.5a6 6 0 0 1 7 0M12 19.5h.01' },
    { d: 'M3 3l18 18' },
  ],
  alert: [{ d: 'M12 3l10 18H2z' }, { d: 'M12 10v4M12 17.5h.01' }],
  info: [{ circle: [12, 12, 9] }, { d: 'M12 11v6M12 7.5h.01' }],
  search: [{ circle: [11, 11, 7] }, { d: 'M20 20l-4-4' }],
  refresh: [{ d: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7' }],
  sun: [{ circle: [12, 12, 4] }, { d: 'M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' }],
  moon: [{ d: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z' }],
  volume: [{ d: 'M4 9v6h4l5 4V5L8 9z' }, { d: 'M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12' }],
  vibrate: [{ rect: [8, 4, 8, 16, 2] }, { d: 'M4 8v8M20 8v8' }],
  camera: [{ d: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z' }, { circle: [12, 13.5, 3.5] }],
  image: [{ rect: [3, 4, 18, 16, 2] }, { circle: [9, 10, 2] }, { d: 'M21 16l-5-5L5 20' }],
  flag: [{ d: 'M5 21V4M5 4h11l-2 4 2 4H5' }],
  logout: [{ d: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3' }],
  trash: [{ d: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3' }],
  hammer: [{ rect: [6, 3, 14, 5, 1.5] }, { d: 'M13 8v13' }],
  /** Cône de chantier : écran « en construction ». */
  cone: [{ d: 'M10 3h4l4.5 16h-13z' }, { d: 'M8.2 10h7.6M7 14.5h10M3 20h18' }],
  dice: [{ rect: [4, 4, 16, 16, 3] }, { d: 'M9 9h.01M15 15h.01M12 12h.01' }],
  clock: [{ circle: [12, 12, 9] }, { d: 'M12 7v5l3 2' }],
  crown: [{ d: 'M3 8l4 4 5-6 5 6 4-4-2 11H5z' }],
  globe: [{ circle: [12, 12, 9] }, { d: 'M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18' }],
  edit: [{ d: 'M4 20h4L19 9l-4-4L4 16z' }, { d: 'M14 6l4 4' }],
  send: [{ d: 'M4 12l16-8-6 16-3-7z' }],
  calendar: [{ rect: [3, 5, 18, 16, 2] }, { d: 'M3 10h18M8 3v4M16 3v4' }],
  star: [{ d: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z' }],
  medal: [{ circle: [12, 15, 5] }, { d: 'M8.5 3h7l-2 7.5h-3z' }],
  map: [{ d: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z' }, { d: 'M9 4v14M15 6v14' }],
  tv: [{ rect: [3, 6, 18, 13, 2] }, { d: 'M8 3l4 3 4-3' }],
  book: [{ d: 'M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z' }, { d: 'M8 7h7' }],
  bulb: [{ d: 'M9 18h6M10 21h4' }, { d: 'M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z' }],
  link: [{ d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' }],
  mail: [{ rect: [3, 5, 18, 14, 2] }, { d: 'M3 7l9 6 9-6' }],
} satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps {
  name: IconName;
  size?: number;
  /** Couleur explicite (sinon : couleur du texte du thème). */
  color?: string;
  strokeWidth?: number;
}

/** Icône décorative : l'étiquette accessible se met sur le bouton qui la contient. */
export function Icon({ name, size = 22, color, strokeWidth }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.text;
  const width = strokeWidth ?? (name === 'back' ? 2.2 : 2);
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {(ICONS[name] as readonly Shape[]).map((shape, i) => {
        if ('d' in shape) return <Path key={i} d={shape.d} />;
        if ('circle' in shape) {
          const [cx, cy, r] = shape.circle;
          return <Circle key={i} cx={cx} cy={cy} r={r} />;
        }
        const [x, y, w, h, rx] = shape.rect;
        return <Rect key={i} x={x} y={y} width={w} height={h} rx={rx} />;
      })}
    </Svg>
  );
}
