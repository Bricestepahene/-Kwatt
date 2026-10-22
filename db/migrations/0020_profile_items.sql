-- Kwatt · profil, avatars et boutique (écrans 09, 10, 11) : catalogue d'objets générique,
-- objets possédés, avatar choisi et photo de profil modérée (D-10).
-- Plage 0020–0029 (SPEC §8). Complète 0001 sans la modifier.

-- Catalogue d'objets ----------------------------------------------------------------------
-- Un objet = un code (clé de traduction de l'appli), une famille, une rareté, un prix en
-- cauris (NULL : ne s'achète pas), une édition limitée éventuelle, un échelon minimal éventuel
-- et ses données de rendu (jsonb, forme fixée par @kwatt/protocol pour les avatars et cadres).
--
-- Comment un joueur obtient un objet :
--   is_default                         → à tous les profils (teints, coiffe et tenue de base, cadres de base) ;
--   price IS NOT NULL                  → achat (POST /v1/shop/buy), si l'échelon suffit ;
--   price IS NULL AND min_rank         → débloqué en atteignant l'échelon (« Trône du Fon ») ;
--   sinon                              → récompense seulement (grantItem : quêtes, trophées, cartes…).
-- Les familles et raretés sont des textes contrôlés (CHECK) et non des ENUM, pour qu'une
-- migration puisse en ajouter sans ALTER TYPE.
CREATE TABLE items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  kind            text NOT NULL CHECK (kind IN (
                    'avatar_skin','avatar_hat','avatar_outfit','avatar_preset','frame',
                    'card','board_skin','piece_skin','dice_skin')),
  rarity          text NOT NULL DEFAULT 'commune' CHECK (rarity IN ('commune','rare','epique','legendaire')),
  price           integer CHECK (price IS NULL OR price > 0),       -- cauris
  edition_total   integer CHECK (edition_total IS NULL OR edition_total > 0),
  edition_sold    integer NOT NULL DEFAULT 0 CHECK (edition_sold >= 0), -- exemplaires attribués
  min_rank        text CHECK (min_rank IN ('apprenti','debrouillard','ancien','notable','chef','fon')),
  is_default      boolean NOT NULL DEFAULT false,
  render          jsonb NOT NULL DEFAULT '{}',
  sort_order      integer NOT NULL DEFAULT 0,
  -- Objet retiré de la vente (il reste à ceux qui l'ont) : une édition limitée ne revient jamais.
  retired_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (edition_total IS NULL OR edition_sold <= edition_total),
  CHECK (NOT is_default OR (price IS NULL AND edition_total IS NULL AND min_rank IS NULL))
);
CREATE INDEX items_kind ON items (kind, sort_order);

-- Objets possédés -------------------------------------------------------------------------
-- Un objet au plus une fois par joueur. Numéro d'exemplaire pour les éditions limitées,
-- attribué par le compteur items.edition_sold (ligne verrouillée) : jamais deux fois le même.
CREATE TABLE owned_items (
  user_id      uuid NOT NULL REFERENCES users(id),
  item_id      uuid NOT NULL REFERENCES items(id),
  serial       integer CHECK (serial IS NULL OR serial > 0),
  source       text NOT NULL CHECK (source IN ('purchase','reward','default')),
  tx_id        uuid REFERENCES ledger_transactions(id),           -- achat : mouvement du grand livre
  acquired_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id),
  CHECK (source <> 'purchase' OR tx_id IS NOT NULL)
);
CREATE UNIQUE INDEX owned_items_serial ON owned_items (item_id, serial) WHERE serial IS NOT NULL;
CREATE INDEX owned_items_item ON owned_items (item_id);

-- Avatar choisi, cadre et photo -----------------------------------------------------------
-- avatar_item_id (avatar prêt) et frame_item_id existaient sans clé étrangère (0001) ;
-- l'avatar composé garde ses trois pièces. La photo est modérée : photo_status pending,
-- approved ou rejected ; photo_path est le chemin du fichier sous MEDIA_DIR.
ALTER TABLE profiles
  ADD COLUMN avatar_mode       text NOT NULL DEFAULT 'avatar' CHECK (avatar_mode IN ('avatar','photo')),
  ADD COLUMN avatar_skin_id    uuid REFERENCES items(id),
  ADD COLUMN avatar_hat_id     uuid REFERENCES items(id),
  ADD COLUMN avatar_outfit_id  uuid REFERENCES items(id),
  ADD COLUMN photo_path        text,
  ADD COLUMN photo_uploaded_at timestamptz,
  ADD COLUMN photo_reviewed_at timestamptz;
ALTER TABLE profiles ADD CONSTRAINT profiles_avatar_item_fk FOREIGN KEY (avatar_item_id) REFERENCES items(id);
ALTER TABLE profiles ADD CONSTRAINT profiles_frame_item_fk FOREIGN KEY (frame_item_id) REFERENCES items(id);
-- Un avatar composé a toujours un teint et une tenue (la coiffe est facultative).
ALTER TABLE profiles ADD CONSTRAINT profiles_avatar_parts_check
  CHECK ((avatar_skin_id IS NULL) = (avatar_outfit_id IS NULL));
CREATE INDEX profiles_photo_pending ON profiles (photo_uploaded_at) WHERE photo_status = 'pending';
