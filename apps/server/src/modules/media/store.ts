/**
 * Médias (photos de profil…) : fichiers rangés dans MEDIA_DIR (un volume Docker en
 * production), servis tels quels sous /media/. Le module Profil s'occupe du recadrage
 * (sharp, 512×512 WebP) et de la modération (PHOTO_AUTO_APPROVE).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

export class MediaStore {
  constructor(
    readonly dir: string,
    private readonly publicBaseUrl: string,
    readonly maxBytes: number,
  ) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  /** Chemin absolu d'un fichier, refusé s'il sort du dossier des médias. */
  pathOf(relPath: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(relPath) || relPath.includes('..')) {
      throw new Error(`Chemin de média invalide : ${relPath}`);
    }
    const abs = resolve(this.dir, relPath);
    const rel = relative(this.dir, abs);
    if (rel.startsWith('..') || rel.startsWith(sep)) throw new Error(`Chemin de média invalide : ${relPath}`);
    return abs;
  }

  /** URL publique d'un fichier (`https://<domaine>/media/<chemin>`). */
  urlOf(relPath: string): string {
    return `${this.publicBaseUrl}/media/${relPath}`;
  }

  /** Écrit un fichier de façon atomique (fichier temporaire puis renommage). */
  async save(relPath: string, data: Uint8Array): Promise<string> {
    const abs = this.pathOf(relPath);
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.${randomUUID()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, abs);
    return this.urlOf(relPath);
  }

  async remove(relPath: string): Promise<void> {
    await rm(this.pathOf(relPath), { force: true });
  }
}
