/**
 * Appels REST des comptes (types de @kwatt/protocol). Le serveur fait foi : chaque erreur
 * arrive en ApiError avec un code, traduit par l'appli (errors:<code>).
 */
import type {
  AuthSessionResponse,
  DeleteAccountResponse,
  DisplayNameResponse,
  ExportResponse,
  LoginResponse,
  Me,
  MyQuarterResponse,
  NotificationPreferences,
  PseudoAvailabilityResponse,
  QuarterListResponse,
  RegisterResponse,
  ResendCodeResponse,
  ResetVerifyResponse,
  RoomPreview,
  Settings,
  SettingsResponse,
} from '@kwatt/protocol';
import { api, getDevice } from '../../api/client';
import { isApiError } from '../../api/errors';
import { currentLanguage, type Language } from '../../i18n';

export interface RegisterInput {
  pseudo: string;
  email: string;
  password: string;
  birthYear: number;
  acceptTerms: boolean;
}

export const accountsApi = {
  async login(login: string, password: string): Promise<LoginResponse> {
    return api.post<LoginResponse>('/v1/auth/login', { login: login.trim(), password, device: await getDevice() }, { auth: false });
  },

  /**
   * Inscription. Avec la session invitée de l'appareil, son jeton part avec la demande : le
   * compte invité est converti (mêmes parties). Si ce jeton n'est plus valable, le serveur
   * retrouve l'invité par l'identifiant d'installation.
   */
  async register(input: RegisterInput): Promise<RegisterResponse> {
    const body = { ...input, locale: currentLanguage(), device: await getDevice() };
    try {
      return await api.post<RegisterResponse>('/v1/auth/register', body);
    } catch (error) {
      if (isApiError(error) && error.code === 'auth.session_expired') {
        return api.post<RegisterResponse>('/v1/auth/register', body, { auth: false });
      }
      throw error;
    }
  },

  pseudoAvailability(pseudo: string, signal?: AbortSignal): Promise<PseudoAvailabilityResponse> {
    return api.get<PseudoAvailabilityResponse>('/v1/auth/pseudo/availability', { query: { pseudo }, auth: false, ...(signal ? { signal } : {}) });
  },

  forgotPassword(email: string): Promise<void> {
    return api.post('/v1/auth/password/forgot', { email: email.trim(), locale: currentLanguage() }, { auth: false });
  },

  verifyResetCode(email: string, code: string): Promise<ResetVerifyResponse> {
    return api.post<ResetVerifyResponse>('/v1/auth/password/reset/verify', { email: email.trim(), code }, { auth: false });
  },

  async resetPassword(resetToken: string, newPassword: string): Promise<AuthSessionResponse> {
    return api.post<AuthSessionResponse>('/v1/auth/password/reset', { resetToken, newPassword, device: await getDevice() }, { auth: false });
  },

  verifyEmail(code: string): Promise<Me> {
    return api.post<Me>('/v1/auth/email/verify', { code });
  },

  resendVerification(): Promise<ResendCodeResponse> {
    return api.post<ResendCodeResponse>('/v1/auth/email/resend', {});
  },

  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return api.post('/v1/auth/password/change', { currentPassword, newPassword });
  },

  logoutAll(): Promise<void> {
    return api.post('/v1/auth/logout-all', {});
  },

  me(): Promise<Me> {
    return api.get<Me>('/v1/me');
  },

  changePseudo(pseudo: string): Promise<Me> {
    return api.patch<Me>('/v1/me/pseudo', { pseudo });
  },

  changeLocale(locale: Language): Promise<Me> {
    return api.patch<Me>('/v1/me/locale', { locale });
  },

  patchSettings(settings: Settings): Promise<SettingsResponse> {
    return api.patch<SettingsResponse>('/v1/me/settings', { settings });
  },

  notificationPreferences(): Promise<NotificationPreferences> {
    return api.get<NotificationPreferences>('/v1/notifications/preferences');
  },

  putNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences> {
    return api.put<NotificationPreferences>('/v1/notifications/preferences', prefs);
  },

  registerPushToken(token: string): Promise<void> {
    return api.post('/v1/notifications/push-token', { token });
  },

  deleteAccount(password: string): Promise<DeleteAccountResponse> {
    return api.post<DeleteAccountResponse>('/v1/me/delete', { password });
  },

  exportData(): Promise<ExportResponse> {
    return api.get<ExportResponse>('/v1/me/export');
  },

  quarters(q: string, signal?: AbortSignal): Promise<QuarterListResponse> {
    return api.get<QuarterListResponse>('/v1/quarters', { query: { q: q.trim() || undefined, limit: 20 }, ...(signal ? { signal } : {}) });
  },

  myQuarter(): Promise<MyQuarterResponse> {
    return api.get<MyQuarterResponse>('/v1/me/quarter');
  },

  setQuarter(quarterId: string): Promise<MyQuarterResponse> {
    return api.put<MyQuarterResponse>('/v1/me/quarter', { quarterId });
  },

  displayName(): Promise<DisplayNameResponse> {
    return api.get<DisplayNameResponse>('/v1/me/display-name');
  },

  setDisplayName(displayName: string): Promise<DisplayNameResponse> {
    return api.put<DisplayNameResponse>('/v1/me/display-name', { displayName });
  },

  /** Aperçu d'un salon (équipe Parties en ligne) ; sans session, l'appel part sans jeton. */
  roomByCode(code: string, withSession: boolean, signal?: AbortSignal): Promise<RoomPreview> {
    return api.get<RoomPreview>(`/v1/rooms/by-code/${encodeURIComponent(code)}`, { auth: withSession, ...(signal ? { signal } : {}) });
  },
};

/** Clés du cache React Query des comptes. */
export const accountKeys = {
  me: ['me'] as const,
  myQuarter: ['me', 'quarter'] as const,
  displayName: ['me', 'displayName'] as const,
  quarters: (q: string) => ['quarters', q.trim().toLowerCase()] as const,
  room: (code: string) => ['rooms', 'byCode', code] as const,
  pseudo: (pseudo: string) => ['pseudo', pseudo.toLowerCase()] as const,
};
