/**
 * Mots de passe : argon2id (@node-rs/argon2, algorithme par défaut), jamais stockés en clair.
 */
import { hash, verify } from '@node-rs/argon2';

export class PasswordHasher {
  private dummy: Promise<string> | null = null;

  constructor(private readonly memoryCostKib: number) {}

  hash(password: string): Promise<string> {
    return hash(password, { memoryCost: this.memoryCostKib, timeCost: 2, parallelism: 1 });
  }

  async verify(stored: string, password: string): Promise<boolean> {
    try {
      return await verify(stored, password);
    } catch {
      return false;
    }
  }

  /**
   * Vérification factice quand le compte n'existe pas : même durée de réponse,
   * pour ne pas révéler l'existence d'un pseudo ou d'une adresse.
   */
  async verifyDummy(password: string): Promise<false> {
    this.dummy ??= this.hash('kwatt-mot-de-passe-factice');
    await this.verify(await this.dummy, password);
    return false;
  }
}
