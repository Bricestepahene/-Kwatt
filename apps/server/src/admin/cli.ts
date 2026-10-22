/**
 * Petite CLI d'administration, directement sur la base (DATABASE_URL).
 *
 *   Développement : pnpm --filter @kwatt/server admin <commande> [arguments]
 *   Production    : docker compose -f deploy/docker-compose.prod.yml exec api node dist/admin/cli.js <commande> …
 *
 * Commandes :
 *   stats                                   chiffres clés (comptes, sessions, cauris, tâches)
 *   user <pseudo|e-mail|id>                 fiche d'un compte
 *   verify-email <pseudo|e-mail|id>         marque l'adresse comme vérifiée (déploiement sans SMTP)
 *   set-birth-year <pseudo|e-mail|id> <année>
 *   adjust <pseudo|e-mail|id> <montant> <motif…>   ajoute (ou retire, montant négatif) des cauris
 *   revoke-sessions <pseudo|e-mail|id>      déconnecte tous les appareils
 *   cancel-deletion <pseudo|e-mail|id>      annule une suppression demandée
 *   erase-due                               efface tout de suite les comptes arrivés à J+30
 *   photos [pending|approved|rejected]      photos de profil à modérer (ou déjà modérées)
 *   photo-approve <pseudo|e-mail|id>        approuve la photo de profil (visible de tous)
 *   photo-reject <pseudo|e-mail|id>         refuse la photo de profil (fichier supprimé)
 *   gen-secret                              tire un secret (JWT_ACCESS_SECRET, ADMIN_TOKEN…)
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../app.js';
import { loadConfig, loadDotEnv } from '../config.js';
import { createPool } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import {
  adjustBalance,
  cancelDeletion,
  findUsers,
  markEmailVerified,
  resolveUserId,
  revokeAllSessions,
  setBirthYear,
  stats,
} from '../modules/admin/service.js';
import { eraseDueAccounts } from '../modules/me/service.js';
import { listPhotos, photoDeps, reviewPhoto } from '../modules/profiles/photo.js';

const USAGE = `Usage : admin <commande> [arguments]
  stats
  user <pseudo|e-mail|id>
  verify-email <pseudo|e-mail|id>
  set-birth-year <pseudo|e-mail|id> <année>
  adjust <pseudo|e-mail|id> <montant> <motif…>
  revoke-sessions <pseudo|e-mail|id>
  cancel-deletion <pseudo|e-mail|id>
  erase-due
  photos [pending|approved|rejected]
  photo-approve <pseudo|e-mail|id>
  photo-reject <pseudo|e-mail|id>
  gen-secret`;

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function run(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command === undefined || command === 'help' || command === '--help') {
    console.log(USAGE);
    return command === undefined ? 1 : 0;
  }
  if (command === 'gen-secret') {
    console.log(randomBytes(48).toString('base64url'));
    return 0;
  }

  loadDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL manquant.');
    return 1;
  }
  const db = createPool(url, 2);
  const now = new Date();
  const need = (n: number) => {
    if (rest.length < n) throw new Error(USAGE);
  };
  try {
    switch (command) {
      case 'stats':
        print(await stats(db));
        break;
      case 'user':
        need(1);
        print(await findUsers(db, rest[0] ?? ''));
        break;
      case 'verify-email':
        need(1);
        await markEmailVerified(db, await resolveUserId(db, rest[0] ?? ''), now);
        console.log('Adresse marquée comme vérifiée.');
        break;
      case 'set-birth-year':
        need(2);
        await setBirthYear(db, await resolveUserId(db, rest[0] ?? ''), Number(rest[1]), now);
        console.log('Année de naissance enregistrée.');
        break;
      case 'adjust': {
        need(3);
        const userId = await resolveUserId(db, rest[0] ?? '');
        const result = await adjustBalance(db, userId, Number(rest[1]), rest.slice(2).join(' '), `cli:${randomUUID()}`);
        print(result);
        break;
      }
      case 'revoke-sessions': {
        need(1);
        const revoked = await revokeAllSessions(db, await resolveUserId(db, rest[0] ?? ''), now);
        console.log(`${revoked.length} session(s) fermée(s). Les WebSocket ouvertes se couperont au prochain contrôle.`);
        break;
      }
      case 'cancel-deletion':
        need(1);
        console.log((await cancelDeletion(db, await resolveUserId(db, rest[0] ?? ''))) ? 'Suppression annulée.' : 'Aucune suppression en cours.');
        break;
      case 'erase-due': {
        // Le serveur complet est assemblé (sans écouter) pour charger les crochets
        // d'effacement de tous les modules.
        const app = await buildApp({ config: { ...loadConfig(), jobsEnabled: false }, pool: db, logger: false });
        try {
          console.log(`${await eraseDueAccounts(db, app.accounts, now)} compte(s) effacé(s).`);
        } finally {
          await app.close();
        }
        break;
      }
      case 'photos':
      case 'photo-approve':
      case 'photo-reject': {
        // Serveur assemblé sans écouter : dossier des médias et notifications du joueur.
        const app = await buildApp({ config: { ...loadConfig(), jobsEnabled: false }, pool: db, logger: false });
        try {
          if (command === 'photos') {
            const status = rest[0] === 'approved' || rest[0] === 'rejected' ? rest[0] : 'pending';
            print(await listPhotos(db, app.media, status));
          } else {
            need(1);
            const decision = command === 'photo-approve' ? 'approve' : 'reject';
            const result = await reviewPhoto(photoDeps(app), await resolveUserId(db, rest[0] ?? ''), decision);
            console.log(result.status === 'approved' ? 'Photo approuvée.' : 'Photo refusée et supprimée.');
          }
        } finally {
          await app.close();
        }
        break;
      }
      default:
        console.error(`Commande inconnue : ${command}\n${USAGE}`);
        return 1;
    }
    return 0;
  } catch (err) {
    if (err instanceof AppError) console.error(`Erreur : ${err.code} ${JSON.stringify(err.params)}`);
    else console.error(err instanceof Error ? err.message : err);
    return 1;
  } finally {
    await db.end();
  }
}

process.exitCode = await run(process.argv.slice(2));
