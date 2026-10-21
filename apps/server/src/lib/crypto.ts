/**
 * Aléa cryptographique et empreintes. Jamais de Math.random pour un secret ou un code.
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Jeton opaque (renouvellement, réinitialisation) : 32 octets en base64url. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Code à `digits` chiffres, tiré uniformément (randomInt évite le biais du modulo). */
export function randomDigits(digits: number): string {
  let out = '';
  for (let i = 0; i < digits; i++) out += String(randomInt(0, 10));
  return out;
}

/** Empreinte HMAC-SHA256 (hex) : seule l'empreinte d'un jeton ou d'un code est stockée. */
export function hmacHex(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** Comparaison en temps constant de deux chaînes. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // Comparer quand même pour ne pas révéler la longueur par le temps de réponse.
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}
