#!/usr/bin/env bash
set -eu

APP_ROOT="${1:-/opt/hakugyokurou}"
BACKUP_ROOT="${2:-/var/backups/hakugyokurou}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_ROOT"
SERVER_ROOT="$APP_ROOT/ai-trpg-server"
ITEMS=()
for item in users.json characters.json notebooks.json logs saves; do
  if [ -e "$SERVER_ROOT/$item" ]; then
    ITEMS+=("$item")
  fi
done

if [ "${#ITEMS[@]}" -eq 0 ]; then
  echo "No runtime data found under $SERVER_ROOT" >&2
  exit 1
fi

tar -czf "$BACKUP_ROOT/trpg-data-$STAMP.tar.gz" -C "$SERVER_ROOT" "${ITEMS[@]}"

find "$BACKUP_ROOT" -type f -name 'trpg-data-*.tar.gz' -mtime +14 -delete
echo "Backup written to $BACKUP_ROOT/trpg-data-$STAMP.tar.gz"
