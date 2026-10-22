/** Codes d'erreur des comptes, de la connexion et des sessions (SPEC §6). */
export const AUTH_ERRORS = [
  /** Jeton d'accès absent. */
  'auth.required',
  /** Jeton d'accès illisible ou signé par une autre clé. */
  'auth.token_invalid',
  /** Jeton d'accès expiré : renouveler avec le jeton de renouvellement. */
  'auth.token_expired',
  /** Session fermée (déconnexion, mot de passe changé, suppression du compte…). */
  'auth.session_revoked',
  /** Pseudo, e-mail ou mot de passe incorrect (sans dire lequel). */
  'auth.invalid_credentials',
  /** Trop d'essais (params.retryAfterSeconds). */
  'auth.too_many_attempts',
  /** Adresse e-mail déjà utilisée par un profil. */
  'auth.email_taken',
  /** Pseudo déjà pris (params.suggestions : 3 propositions). */
  'auth.pseudo_taken',
  /** Pseudo hors des règles : 3 à 20 caractères [a-zA-Z0-9_.]. */
  'auth.pseudo_invalid',
  /** Pseudo contenant un mot interdit ou réservé. */
  'auth.pseudo_banned',
  /** Mot de passe trop court (params.min). */
  'auth.password_too_short',
  /** Moins de 13 ans : pas de profil, jeu en invité seulement. */
  'auth.too_young',
  /** Année de naissance impossible. */
  'auth.birth_year_invalid',
  /** Les règles du quartier et la politique de confidentialité doivent être acceptées. */
  'auth.consent_required',
  /** Code à 6 chiffres faux (params.attemptsLeft quand on peut le dire sans rien révéler). */
  'auth.code_invalid',
  /** Code expiré ou épuisé (5 essais) : en demander un nouveau. */
  'auth.code_expired',
  /** Renvoi du code trop tôt (params.retryAfterSeconds). */
  'auth.code_resend_too_soon',
  /** Adresse déjà vérifiée. */
  'auth.already_verified',
  /** Jeton de renouvellement inconnu. */
  'auth.refresh_invalid',
  /** Jeton de renouvellement expiré : se reconnecter. */
  'auth.refresh_expired',
  /** Ancien jeton de renouvellement réutilisé : sessions de l'appareil fermées par sécurité. */
  'auth.refresh_reused',
  /** Jeton de réinitialisation du mot de passe inconnu, expiré ou déjà utilisé. */
  'auth.reset_token_invalid',
  /** Mot de passe actuel incorrect (changement de mot de passe, suppression du compte). */
  'auth.wrong_password',
  /** Réservé aux profils (pas aux invités). */
  'auth.member_required',
  /** Réservé aux 18 ans et plus. */
  'auth.adult_required',
  /** Adresse e-mail à vérifier d'abord (mises, récupération du compte). */
  'auth.verification_required',
  /** L'appareil n'a pas envoyé d'identifiant d'installation valide. */
  'auth.device_required',
] as const;
