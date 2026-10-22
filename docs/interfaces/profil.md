# Interfaces · profil, avatars et boutique

Rapport de l'équipe Profil (vague 2). Le code fait foi en cas d'écart.

## Base (migrations 0020–0021)
- `items` : catalogue générique (`code` = clé de traduction, `kind` avatar_skin | avatar_hat | avatar_outfit | avatar_preset | frame | card | board_skin | piece_skin | dice_skin, `rarity` commune | rare | epique | legendaire, `price` en cauris ou NULL, `edition_total` / `edition_sold`, `min_rank`, `is_default`, `render` jsonb, `sort_order`, `retired_at`). Familles et raretés en CHECK (pas d'ENUM) : une migration peut en ajouter.
- Possession : ligne `owned_items` (user, item, `serial`, `source` purchase | reward | default, `tx_id`), ou `is_default`, ou `price IS NULL AND min_rank` atteint (meilleur échelon, toutes variantes).
- `profiles` : `avatar_mode` avatar | photo, `avatar_skin_id`, `avatar_hat_id`, `avatar_outfit_id`, `avatar_item_id` (avatar prêt), `frame_item_id`, `photo_path`, `photo_status`, `photo_uploaded_at`, `photo_reviewed_at`.

## Serveur
- `grantItem(dbOuTx, userId, itemCode, 'reward' | 'default')` (`modules/shop/catalog.ts`) : idempotent, numéro d'exemplaire pour une édition limitée, `shop.sold_out` / `shop.item_not_found`.
- `loadLooks(db, app.media, userIds, viewerId?)` (`modules/profiles/look.ts`) → `Map<userId, PlayerLook>` ; absents → `DEFAULT_LOOK`.
- `registerProfileRelation(nom, (db, viewerId, targetId) => Promise<boolean>)` (`modules/profiles/visibility.ts`) : à brancher par Communauté (amis) pour la visibilité des comptes jeunes.
- Lectures chez les autres équipes (`modules/profiles/links.ts`) : quartier (`quarters` + `profiles.quarter_id`, sinon `profiles.quarter`), médailles (`medals.kind` or | argent | bronze) si les tables existent.
- REST : `GET /v1/shop/items?kinds=`, `POST /v1/shop/buy {itemCode} | {itemCodes}`, `GET /v1/me/profile`, `GET /v1/profiles/:userId`, `GET|PUT /v1/me/avatar`, `POST|DELETE /v1/me/photo`, `GET /v1/admin/photos?status=`, `POST /v1/admin/photos/:userId/approve|reject`. CLI : `admin photos`, `photo-approve`, `photo-reject`.
- Notifications : `profile.photo_approved`, `profile.photo_rejected` (textes push dans `src/i18n`).
- Grand livre : mouvement `purchase` (clé `purchase:<joueur>:<objet>`, meta `{itemCode, itemKind, serial}`) vers le compte système `shop`.

## Protocole (`@kwatt/protocol`)
`http/shop.ts` (ITEM_KINDS, ITEM_RARITIES, PROFILE_RANKS, schémas de rendu, ShopItem, Buy*, CARD_COLLECTION_SIZE 48), `http/profiles.ts` (AvatarView, PlayerLook, DEFAULT_LOOK, MyAvatar, SaveAvatarRequest, Profile, FamilyProfile, RecentGame, PhotoReviewItem, JournalMetaSchema : convention `meta` du journal), erreurs `errors/shop.ts`, `errors/profiles.ts`.

## Appli
- `src/features/profile/looks.ts` : `avatarProps(look)` → props de `<Avatar>` (kit étendu : `kind: 'preset'`, coiffes bonnet | foulard | toque | couronne).
- `src/features/profile/api.ts` : hooks React Query (`useMyProfile`, `usePlayerProfile`, `useCatalog`, `useBuy`, `useSaveAvatar`, `useUploadPhoto`, `useDeletePhoto`, `useJournal`).
- Noms d'objets : catalogue `items` (`items:name.<code>`) ; l'équipe Progression y ajoute ses cartes.
- Routes : `/profil`, `/joueur/[id]`, `/profil/cauris`, `/avatar`, `/avatar/boutique`.
