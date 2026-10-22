# Déployer Kwatt sur un VPS

Ce guide installe le serveur Kwatt sur un VPS Ubuntu, pas à pas : nom de domaine, Docker, configuration, premier lancement, migrations, sauvegardes et restauration, mises à jour, journaux.
Tout tourne avec `docker compose` sur une seule machine (décision D-02 : pas de Redis en V1).

```
Internet ──443──▶ caddy (HTTPS automatique) ──▶ api :8080 (@kwatt/server : REST, WebSocket, /media, /s, /l)
                                                  ├──▶ postgres :5432 (volume pgdata)
                                                  └──▶ ludo-ai :8090 (moteur du Ludo)
                  backup : pg_dump chaque nuit ──▶ deploy/backups (14 jours)
```

| Fichier | Rôle |
|---|---|
| `deploy/docker-compose.prod.yml` | les cinq services : `caddy`, `api`, `ludo-ai`, `postgres`, `backup` |
| `deploy/compose.sh` | raccourci : `docker compose --env-file .env -f deploy/docker-compose.prod.yml …` |
| `deploy/Caddyfile` | HTTPS (Let's Encrypt) pour `DOMAIN`, tout est relayé vers l'API |
| `deploy/backup.sh` | sauvegarde quotidienne, liste, restauration |
| `apps/server/Dockerfile` | image de l'API (construite depuis la racine du dépôt) |
| `.env` (copie de `.env.example`) | toute la configuration et les secrets, **jamais versionné** |

---

## 1. Ce qu'il faut avant de commencer

- Un **VPS** sous **Ubuntu 24.04 LTS** (22.04 convient aussi) : 2 vCPU, 2 à 4 Go de mémoire, 20 Go de disque suffisent pour un groupe d'amis.
- Un **nom de domaine** (ou un sous-domaine), par exemple `kwatt.mondomaine.cm`.
- Un accès **SSH** au VPS, avec une clé (pas de mot de passe).
- Facultatif : un compte chez un fournisseur d'e-mail **SMTP** (Brevo, Mailjet, OVH, Gmail avec mot de passe d'application…) pour envoyer les codes à 6 chiffres. Sans SMTP, les codes s'écrivent dans le journal du serveur (voir § 9).

Dans ce guide, `kwatt.mondomaine.cm` est le domaine et `203.0.113.10` l'adresse IP du VPS : remplacez-les par les vôtres.

---

## 2. Le nom de domaine (DNS)

Chez le gestionnaire du domaine, créez :

| Type | Nom | Valeur |
|---|---|---|
| `A` | `kwatt` (ou `@` pour le domaine nu) | `203.0.113.10` |
| `AAAA` (si le VPS a une IPv6) | `kwatt` | l'adresse IPv6 du VPS |

Vérifiez depuis votre ordinateur (la propagation prend de quelques minutes à quelques heures) :

```sh
dig +short kwatt.mondomaine.cm      # doit afficher 203.0.113.10
```

Caddy ne pourra obtenir le certificat HTTPS qu'une fois le DNS en place **et** les ports 80 et 443 ouverts.

---

## 3. Préparer le serveur

Connectez-vous (`ssh ubuntu@203.0.113.10`), puis :

```sh
# Mises à jour, et mises à jour de sécurité automatiques
sudo apt update && sudo apt -y upgrade
sudo apt -y install unattended-upgrades git
sudo dpkg-reconfigure -plow unattended-upgrades

# Pare-feu : SSH, HTTP et HTTPS seulement (PostgreSQL et l'API ne sont jamais exposés)
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
```

> Seul le service `caddy` publie des ports (80 et 443). `api`, `ludo-ai` et `postgres` ne sont joignables que sur le réseau interne de Docker.

---

## 4. Installer Docker

Docker Engine et le greffon Compose, depuis le dépôt officiel de Docker :

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit    # se déconnecter puis se reconnecter pour que le groupe « docker » prenne effet
```

Vérifiez :

```sh
docker --version
docker compose version     # Compose v2 ou plus récent
```

---

## 5. Récupérer le code

```sh
cd ~
git clone https://github.com/Bricestepahene/-Kwatt.git kwatt
cd kwatt
git checkout main          # ou la branche / l'étiquette à déployer
```

Toutes les commandes suivantes se lancent depuis ce dossier `~/kwatt`.

---

## 6. Configurer `.env`

```sh
cp .env.example .env
chmod 600 .env             # lisible par vous seul : il contient les secrets
nano .env
```

Chaque variable est commentée dans le fichier. Celles marquées **[prod]** sont à remplir :

| Variable | Valeur |
|---|---|
| `DOMAIN` | `kwatt.mondomaine.cm` |
| `ACME_EMAIL` | votre adresse (Let's Encrypt y écrit en cas de problème de certificat) |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `JWT_ACCESS_SECRET` | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32` (une autre valeur) |
| `ADMIN_TOKEN` | `openssl rand -hex 32` (vide = pas de routes d'administration) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | les réglages de votre fournisseur d'e-mail (vide = codes dans le journal) |
| `PHOTO_AUTO_APPROVE` | voir § 12 |
| `APP_INSTALL_URL` | lien d'installation de l'appli (page expo.dev…), montré sur les pages de partage |

Pour tirer un secret directement dans le fichier, par exemple :

```sh
sed -i "s/^JWT_ACCESS_SECRET=.*/JWT_ACCESS_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s/^JWT_REFRESH_SECRET=.*/JWT_REFRESH_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
sed -i "s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=$(openssl rand -hex 32)/" .env
```

Inutile de toucher à `DATABASE_URL`, `NODE_ENV`, `PUBLIC_BASE_URL`, `TRUST_PROXY`, `MEDIA_DIR` ni `LUDO_AI_URL` : le fichier `deploy/docker-compose.prod.yml` les pose lui-même pour la production.

> **Attention :** `POSTGRES_PASSWORD` n'est lu qu'au **tout premier** démarrage de PostgreSQL (création du volume). Le changer ensuite ne change pas le mot de passe de la base : voir § 13.

> **Ne jamais versionner `.env`** (il est dans `.gitignore`). Gardez une copie des secrets dans un gestionnaire de mots de passe : sans `JWT_REFRESH_SECRET`, tous les joueurs doivent se reconnecter.

---

## 7. Premier lancement

```sh
./deploy/compose.sh up -d --build
```

La première construction prend quelques minutes. Ensuite :

```sh
./deploy/compose.sh ps                 # tous les services « running », api et postgres « healthy »
./deploy/compose.sh logs -f api        # Ctrl+C pour quitter
curl https://kwatt.mondomaine.cm/v1/health
# {"status":"ok","db":"ok","version":"<commit>","uptimeSeconds":12,"time":"…"}
```

La page `https://kwatt.mondomaine.cm/s/ABCDEF` doit afficher l'invitation à un salon.

> **Moteur du Ludo pas encore prêt ?** Le service `ludo-ai` se construit depuis `services/ludo-ai/Dockerfile`. Tant que ce fichier n'existe pas, lancez les autres services seulement :
> `./deploy/compose.sh up -d --build caddy api postgres backup`

Enfin, l'appli se branche sur le serveur avec, dans `apps/mobile/.env` (voir `apps/mobile/.env.example`) :

```
EXPO_PUBLIC_API_URL=https://kwatt.mondomaine.cm
EXPO_PUBLIC_WS_URL=wss://kwatt.mondomaine.cm/v1/ws
```

---

## 8. Migrations de la base

- Les migrations (`db/migrations/NNNN_nom.sql`) sont copiées dans l'image et **appliquées automatiquement à chaque démarrage** de l'API (`MIGRATE_ON_START=true` dans le compose). Chacune s'exécute dans sa transaction et n'est appliquée qu'une fois (table `schema_migrations`) ; un verrou empêche deux lancements simultanés.
- Pour les appliquer à la main (et lire le résultat) :

  ```sh
  ./deploy/compose.sh exec api node dist/db/migrate-cli.js
  # « Base à jour (5 migrations déjà appliquées). »
  ```

- Voir ce qui est appliqué :

  ```sh
  ./deploy/compose.sh exec postgres psql -U kwatt -d kwatt -c "SELECT version, name, applied_at FROM schema_migrations ORDER BY version"
  ```

- Règle : une migration déjà livrée ne se modifie **jamais** ; on en ajoute une nouvelle (`ALTER TABLE …`). Une migration modifiée est signalée dans le journal au démarrage.
- En développement : `pnpm db:migrate` (avec `DATABASE_URL` de `.env`).

---

## 9. E-mails

- **Avec SMTP** (`SMTP_HOST` rempli) : les codes de vérification, de mot de passe oublié et les alertes partent par e-mail, dans la langue du joueur.
- **Sans SMTP** (petit déploiement entre amis) : chaque e-mail est écrit dans le journal, code compris :

  ```sh
  ./deploy/compose.sh logs api | grep "E-mail (SMTP non configuré)"
  ```

  On peut aussi vérifier une adresse à la main : `./deploy/compose.sh exec api node dist/admin/cli.js verify-email <pseudo>`.

Port 587 avec `SMTP_SECURE=false` (STARTTLS) ou port 465 avec `SMTP_SECURE=true`. Si l'envoi échoue, l'erreur apparaît dans `./deploy/compose.sh logs api`.

---

## 10. Sauvegardes et restauration

### Sauvegarde automatique

Le service `backup` fait un `pg_dump` **chaque nuit** à `BACKUP_HOUR_UTC` heures UTC (2 h UTC = 3 h à Douala) et garde **14 jours** (`BACKUP_KEEP_DAYS`). Les fichiers arrivent dans `deploy/backups/` sur le VPS (`BACKUP_DIR`) :

```sh
./deploy/compose.sh run --rm backup list       # liste des sauvegardes
./deploy/compose.sh run --rm backup now        # une sauvegarde tout de suite (avant une mise à jour…)
./deploy/compose.sh logs backup                # « sauvegarde terminée (2,1M) »
```

### Copie hors du VPS (à faire)

Une sauvegarde qui reste sur le VPS disparaît avec lui. Copiez `deploy/backups/` ailleurs chaque jour, par exemple depuis un autre ordinateur (Linux, macOS) avec `cron` :

```sh
# crontab -e sur l'ordinateur de sauvegarde : chaque jour à 6 h
0 6 * * * rsync -az ubuntu@203.0.113.10:kwatt/deploy/backups/ ~/sauvegardes-kwatt/
```

ou, sur le VPS, avec [rclone](https://rclone.org) vers un stockage en ligne (`rclone copy ~/kwatt/deploy/backups distant:kwatt-backups`).

Les **photos** des joueurs sont dans le volume `kwatt_media`. Pour les sauvegarder aussi :

```sh
docker run --rm -v kwatt_media:/media:ro -v "$PWD/deploy/backups:/out" busybox \
  tar czf "/out/media-$(date +%F).tgz" -C /media .
```

### Restaurer une sauvegarde

```sh
./deploy/compose.sh run --rm backup list                       # choisir le fichier
./deploy/compose.sh stop api                                    # plus personne n'écrit dans la base
./deploy/compose.sh run --rm backup restore /backups/kwatt-2026-10-22T020000Z.dump
./deploy/compose.sh start api
curl https://kwatt.mondomaine.cm/v1/health
```

La base actuelle n'est pas supprimée : elle est renommée `kwatt_avant_<date>`. Si la restauration échoue, elle est remise en place automatiquement. Une fois l'appli vérifiée, supprimez l'ancienne base (la commande exacte est affichée à la fin de la restauration) :

```sh
./deploy/compose.sh exec postgres dropdb -U kwatt kwatt_avant_20261022080000
```

Pour restaurer sur un **nouveau** VPS : suivez ce guide jusqu'au § 7, copiez le fichier de sauvegarde dans `deploy/backups/`, puis faites la restauration ci-dessus. Pensez à reprendre le même `.env` (mêmes `JWT_*` : les joueurs restent connectés).

---

## 11. Mettre à jour

```sh
cd ~/kwatt
./deploy/compose.sh run --rm backup now     # sauvegarde avant la mise à jour
git pull                                     # ou git checkout <étiquette>
./deploy/compose.sh up -d --build            # reconstruit et redémarre ce qui a changé
./deploy/compose.sh ps
curl https://kwatt.mondomaine.cm/v1/health   # « version » = nouveau commit
docker image prune -f                        # supprime les anciennes images
```

Les migrations nouvelles s'appliquent au redémarrage de l'API. Les joueurs connectés sont déconnectés quelques secondes : l'appli se reconnecte seule (Caddy réessaie pendant le redémarrage).

**Revenir en arrière** : `git checkout <commit précédent>` puis `./deploy/compose.sh up -d --build`. Les migrations ne se défont pas : si une migration nouvelle pose problème, restaurez la sauvegarde faite juste avant (§ 10).

Mettre aussi à jour le système de temps en temps : `sudo apt update && sudo apt -y upgrade`, puis `sudo reboot` si demandé (les services redémarrent seuls : `restart: unless-stopped`).

---

## 12. Photos de profil : `PHOTO_AUTO_APPROVE`

Décision D-10 : les photos de profil sont **modérées avant affichage**.

- `PHOTO_AUTO_APPROVE=false` (par défaut) : une photo envoyée attend qu'un modérateur la valide ; en attendant, l'avatar dessiné s'affiche.
- `PHOTO_AUTO_APPROVE=true` : les photos sont publiées tout de suite. À réserver à un déploiement **entre amis**, sans modérateur.

Après un changement de `.env` : `./deploy/compose.sh up -d api` (recrée le conteneur avec la nouvelle valeur).

---

## 13. Journaux, administration, dépannage

### Journaux

```sh
./deploy/compose.sh logs -f api              # API (JSON, une ligne par évènement)
./deploy/compose.sh logs --since 1h api      # la dernière heure
./deploy/compose.sh logs caddy               # certificats, requêtes
./deploy/compose.sh logs postgres backup
```

Les journaux tournent seuls (10 Mo × 5 fichiers par service). Plus de détails : `LOG_LEVEL=debug` dans `.env`, puis `./deploy/compose.sh up -d api`. Les mots de passe, jetons et codes ne sont jamais écrits dans le journal (sauf les e-mails quand SMTP est vide, § 9).

### Administration

Petite CLI, dans le conteneur de l'API :

```sh
./deploy/compose.sh exec api node dist/admin/cli.js help
./deploy/compose.sh exec api node dist/admin/cli.js stats
./deploy/compose.sh exec api node dist/admin/cli.js user brice_237
./deploy/compose.sh exec api node dist/admin/cli.js verify-email brice_237
./deploy/compose.sh exec api node dist/admin/cli.js set-birth-year brice_237 1995     # le joueur ne peut pas la changer
./deploy/compose.sh exec api node dist/admin/cli.js adjust brice_237 200 "lot du tournoi"
./deploy/compose.sh exec api node dist/admin/cli.js revoke-sessions brice_237
./deploy/compose.sh exec api node dist/admin/cli.js cancel-deletion brice_237
```

Avec `ADMIN_TOKEN`, les mêmes outils existent en HTTP :

```sh
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://kwatt.mondomaine.cm/v1/admin/stats
```

### Dépannage

| Symptôme | Piste |
|---|---|
| `curl https://…` échoue, Caddy parle d'ACME ou de challenge | le DNS ne pointe pas encore vers le VPS, ou les ports 80/443 sont fermés (`sudo ufw status`). Voir `./deploy/compose.sh logs caddy`. |
| `api` redémarre en boucle | `./deploy/compose.sh logs api` : « Configuration invalide » liste les variables en défaut ; « JWT_ACCESS_SECRET est obligatoire en production » : secret manquant dans `.env`. |
| `password authentication failed for user "kwatt"` | `POSTGRES_PASSWORD` a changé après la création de la base. Remettre l'ancien, ou changer le mot de passe dans la base : `./deploy/compose.sh exec postgres psql -U kwatt -d kwatt -c "ALTER USER kwatt PASSWORD 'nouveau'"`. |
| `DOMAIN manquant dans .env` | lancer par `./deploy/compose.sh` (qui passe `--env-file .env`), depuis le dossier du dépôt. |
| Erreur de construction de `ludo-ai` | `services/ludo-ai/Dockerfile` absent : lancer sans ce service (§ 7). |
| Les joueurs ne reçoivent pas de code | SMTP vide ou en erreur : § 9. |

---

## Récapitulatif des commandes

| Action | Commande |
|---|---|
| Démarrer / mettre à jour | `./deploy/compose.sh up -d --build` |
| État | `./deploy/compose.sh ps` |
| Journaux | `./deploy/compose.sh logs -f api` |
| Migrations à la main | `./deploy/compose.sh exec api node dist/db/migrate-cli.js` |
| Sauvegarde maintenant | `./deploy/compose.sh run --rm backup now` |
| Restaurer | `stop api` → `run --rm backup restore /backups/<fichier>` → `start api` |
| Arrêter | `./deploy/compose.sh down` (les volumes, donc les données, restent) |
