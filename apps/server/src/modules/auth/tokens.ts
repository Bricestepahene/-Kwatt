/**
 * Jetons d'accès : JWT HS256 signé avec JWT_ACCESS_SECRET (jose), 15 minutes.
 * Contenu : sub = users.id, sid = auth_sessions.id, kind. Rien de personnel.
 * Une session fermée rend ses jetons inutilisables même avant leur expiration
 * (contrôle en base à chaque requête, voir plugin.ts).
 */
import type { UserKind } from '@kwatt/protocol';
import { SignJWT, errors, jwtVerify } from 'jose';
import type { Clock } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';

const ISSUER = 'kwatt';
const AUDIENCE = 'kwatt-app';

export interface AccessClaims {
  userId: string;
  sessionId: string;
  kind: UserKind;
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
    private readonly clock: Clock,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(claims: AccessClaims): Promise<{ token: string; expiresAt: Date }> {
    const now = Math.floor(this.clock.now().getTime() / 1000);
    const exp = now + this.ttlSeconds;
    const token = await new SignJWT({ sid: claims.sessionId, kind: claims.kind })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(this.key);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  /** Vérifie la signature et l'expiration ; lève auth.token_expired ou auth.token_invalid. */
  async verify(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
        currentDate: this.clock.now(),
      });
      const { sub, sid, kind } = payload;
      if (typeof sub !== 'string' || typeof sid !== 'string' || (kind !== 'guest' && kind !== 'member')) {
        throw new AppError('auth.token_invalid', 401);
      }
      return { userId: sub, sessionId: sid, kind };
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof errors.JWTExpired) throw new AppError('auth.token_expired', 401);
      throw new AppError('auth.token_invalid', 401);
    }
  }
}
