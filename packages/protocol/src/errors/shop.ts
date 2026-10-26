/** Codes d'erreur de la boutique et du catalogue d'objets (écrans 10, 11, 39). */
export const SHOP_ERRORS = [
  /** Objet inconnu du catalogue (params.code). */
  'shop.item_not_found',
  /** Objet qui ne s'achète pas : défaut, récompense ou déblocage d'échelon (params.code). */
  'shop.not_for_sale',
  /** Objet déjà possédé (params.code). */
  'shop.already_owned',
  /** Échelon trop bas pour cet objet (params.code, params.requiredRank, params.rank). */
  'shop.rank_too_low',
  /** Édition limitée épuisée (params.code, params.total). */
  'shop.sold_out',
  /** Solde insuffisant : « Il te manque X cauris » (params.price, params.balance, params.missing). */
  'shop.insufficient_funds',
] as const;
