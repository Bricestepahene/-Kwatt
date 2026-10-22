#!/bin/sh
# Sauvegardes PostgreSQL de Kwatt (service « backup » de deploy/docker-compose.prod.yml).
#
#   kwatt-backup loop              tourne en continu : une sauvegarde par jour à BACKUP_HOUR_UTC h (UTC)
#   kwatt-backup now               une sauvegarde tout de suite
#   kwatt-backup list              liste les sauvegardes
#   kwatt-backup restore FICHIER   restaure une sauvegarde (ARRÊTER L'API AVANT, voir docs/DEPLOIEMENT.md)
#
# Format : pg_dump « custom » (compressé), fichiers /backups/kwatt-AAAA-MM-JJTHHMMSSZ.dump.
# Les sauvegardes de plus de BACKUP_KEEP_DAYS jours (14 par défaut) sont supprimées.
# Connexion : variables PGHOST, PGUSER, PGPASSWORD, PGDATABASE.
set -eu

DIR="${BACKUP_DIR_IN_CONTAINER:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
HOUR="${BACKUP_HOUR_UTC:-2}"

log() {
  echo "[kwatt-backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
}

backup_now() {
  mkdir -p "$DIR"
  stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
  final="$DIR/kwatt-$stamp.dump"
  part="$DIR/.kwatt-$stamp.dump.part"
  log "sauvegarde de la base $PGDATABASE vers $final"
  if pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$part"; then
    mv "$part" "$final"
    log "sauvegarde terminée ($(du -h "$final" | cut -f1))"
  else
    rm -f "$part"
    log "ÉCHEC de la sauvegarde"
    return 1
  fi
  # Rotation : on garde les sauvegardes des KEEP_DAYS derniers jours (une heure de marge).
  find "$DIR" -maxdepth 1 -name 'kwatt-*.dump' -type f -mmin +$((KEEP_DAYS * 1440 - 60)) -print -delete |
    while read -r old; do log "supprimée (plus de $KEEP_DAYS jours) : $old"; done
}

seconds_until_next_run() {
  now=$(date -u +%s)
  target=$(date -u -d "$(date -u +%Y-%m-%d) $HOUR:00:00" +%s)
  if [ "$target" -le "$now" ]; then target=$((target + 86400)); fi
  echo $((target - now))
}

case "${1:-loop}" in
  now)
    backup_now
    ;;
  list)
    ls -lh "$DIR"/kwatt-*.dump 2>/dev/null || echo "Aucune sauvegarde dans $DIR."
    ;;
  restore)
    file="${2:?Usage : kwatt-backup restore /backups/kwatt-….dump}"
    [ -f "$file" ] || { echo "Fichier introuvable : $file" >&2; exit 1; }
    # La base actuelle est mise de côté (renommée), jamais supprimée : en cas d'échec on la remet.
    old="${PGDATABASE}_avant_$(date -u +%Y%m%d%H%M%S)"
    log "base actuelle mise de côté sous le nom $old"
    psql -v ON_ERROR_STOP=1 --dbname=postgres \
      -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$PGDATABASE' AND pid <> pg_backend_pid();" \
      -c "ALTER DATABASE \"$PGDATABASE\" RENAME TO \"$old\";" >/dev/null
    createdb "$PGDATABASE"
    log "restauration de $file dans une base $PGDATABASE neuve"
    if pg_restore --exit-on-error --no-owner --no-privileges --dbname="$PGDATABASE" "$file"; then
      log "restauration terminée. Une fois l'appli vérifiée, supprimer l'ancienne base :"
      log "  ./deploy/compose.sh exec postgres dropdb -U \$POSTGRES_USER \"$old\""
    else
      log "ÉCHEC de la restauration : la base d'avant est remise en place"
      psql -v ON_ERROR_STOP=1 --dbname=postgres \
        -c "DROP DATABASE IF EXISTS \"$PGDATABASE\" WITH (FORCE);" \
        -c "ALTER DATABASE \"$old\" RENAME TO \"$PGDATABASE\";" >/dev/null
      exit 1
    fi
    ;;
  loop)
    log "sauvegarde quotidienne à ${HOUR}h UTC, gardée $KEEP_DAYS jours, dans $DIR"
    while true; do
      wait_s=$(seconds_until_next_run)
      log "prochaine sauvegarde dans $((wait_s / 3600)) h $(((wait_s % 3600) / 60)) min"
      sleep "$wait_s"
      backup_now || true
      # Évite deux sauvegardes dans la même minute si l'horloge saute.
      sleep 60
    done
    ;;
  *)
    echo "Usage : kwatt-backup [loop|now|list|restore FICHIER]" >&2
    exit 1
    ;;
esac
