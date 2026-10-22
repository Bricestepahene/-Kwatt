/**
 * Apparence d'un joueur : du contrat du serveur (`PlayerLook` de @kwatt/protocol) aux
 * propriétés du composant Avatar du kit. À reprendre partout où un joueur s'affiche
 * (sièges, amis, classements) :
 *
 *   const props = avatarProps(look);   <Avatar name={pseudo} {...props} />
 *
 * Module pur (testé par vitest).
 */
import type { FabricName } from '@kwatt/design';
import type { AvatarView, HatRender, ItemRarity, PlayerLook } from '@kwatt/protocol';
import type { AvatarSkin, AvatarSpec } from '../../ui/Avatar';

function skinOf(tone: number): AvatarSkin {
  return Math.max(0, Math.min(4, Math.round(tone))) as AvatarSkin;
}

function hatSpec(hat: HatRender | null) {
  return hat ? { fabric: hat.fabric as FabricName, shape: hat.shape } : null;
}

/** Image de profil du serveur → spécification du composant Avatar. */
export function toAvatarSpec(view: AvatarView): AvatarSpec {
  switch (view.kind) {
    case 'photo':
      return { kind: 'photo', uri: view.url };
    case 'composed':
      return { kind: 'composed', skin: skinOf(view.skin), hat: hatSpec(view.hat), outfit: view.outfit };
    case 'preset':
      return { kind: 'preset', skin: skinOf(view.skin), hat: hatSpec(view.hat), outfit: view.outfit, background: view.background };
    default:
      return { kind: 'initial' };
  }
}

export interface AvatarLookProps {
  avatar: AvatarSpec;
  frame: FabricName | null;
  /** Rareté du cadre (un cadre légendaire reçoit un contour de sa couleur). */
  frameRarity: ItemRarity | null;
}

export function avatarProps(look: PlayerLook | null | undefined): AvatarLookProps {
  if (!look) return { avatar: { kind: 'initial' }, frame: null, frameRarity: null };
  return { avatar: toAvatarSpec(look.avatar), frame: look.frame?.fabric ?? null, frameRarity: look.frame?.rarity ?? null };
}
