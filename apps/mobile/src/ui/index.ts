/**
 * Kit de composants de Kwatt, fidèle aux planches (Main, Sommaire, Accueil, Profil,
 * Paramètres, Connexion, Créer un salon, Matrice). Toutes les couleurs viennent du
 * thème (`useTheme().colors`, tiré de @kwatt/design) : aucun écran n'écrit de couleur.
 *
 *   import { Screen, Header, Button, Card, Text } from '@/ui';
 */
export { Text, useToneColor, type TextProps, type TextTone } from './Text';
export { Button, IconButton, type ButtonProps, type ButtonSize, type ButtonVariant, type IconButtonProps } from './Button';
export { Card, type CardProps } from './Card';
export { Chip, Pill, Badge } from './Chip';
export { SegmentedTabs, type SegmentOption } from './SegmentedTabs';
export { TextField, type TextFieldProps } from './TextField';
export { CodeInput, RoomCodeInput } from './CodeInput';
export { Avatar, type AvatarProps, type AvatarSkin, type AvatarSpec } from './Avatar';
export { CauriBadge, RankBadge, type RankId } from './badges';
export { Logo, Wordmark, CauriIcon } from './brand';
export { SectionLabel, ProgressBar } from './SectionLabel';
export { ListItem, ListGroup, type ListItemProps } from './ListItem';
export { Toggle } from './Toggle';
export { Slider } from './Slider';
export { BottomSheet, ConfirmSheet } from './BottomSheet';
export { showToast, hideToast, ToastHost, type ToastTone } from './Toast';
export { EmptyState, LoadingState, ErrorState, OfflineState, Skeleton, OfflineBanner } from './states';
export { Screen, SCREEN_GUTTER, SCREEN_MAX_WIDTH, type ScreenProps } from './Screen';
export { Header, goBack, type HeaderProps } from './Header';
export { BottomTabBar, TAB_ICONS, type BottomTabItem } from './BottomTabBar';
export { Fabric, GameBand, SPACE_FABRIC, FABRICS, FabricDefs, fabricFills, svgId, type FabricName, type FabricProps } from './fabrics';
export { Icon, ICON_NAMES, type IconName, type IconProps } from './icons/Icon';
export {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RANKS,
  extractRoomCode,
  formatRoomCode,
  initialOf,
  isRoomCodeComplete,
  normalizeDigits,
  normalizeRoomCode,
  rankForLevel,
  snap,
} from './logic';
