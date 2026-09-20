#!/bin/bash
# Load the latest PickiPedia backup into a preview database.
#
# Run after 'docker compose up -d' to populate a preview with production data.
# Preview environments restore from these dumps rather than sharing the
# production database — see cryptograss/pickipedia#107 for why that matters.
#
#   ./load-backup.sh                      # the project named in .env
#   ./load-backup.sh pickipedia-magent    # a named project
#   ./load-backup.sh pickipedia-magent --force
#
# This used to pick its target with
#
#     docker ps --filter "name=pickipedia.*db" --format "{{.Names}}" | head -1
#
# which on hunter, where every one of us has a preview running, meant it loaded
# a production dump into whichever database happened to sort first — someone
# else's, silently, over the top of whatever they were doing. So the target is
# named now, and loading over a wiki that already has pages needs --force.

set -euo pipefail

BACKUP_DIR="${PICKIPEDIA_BACKUP_DIR:-/opt/magenta/pickipedia-backups}"

PROJECT=""
FORCE=0
for arg in "$@"; do
    case "$arg" in
        --force) FORCE=1 ;;
        -*) echo "unknown option: $arg" >&2; exit 2 ;;
        *) PROJECT="$arg" ;;
    esac
done

# Fall back to this directory's .env, which is what docker compose would use.
if [ -z "$PROJECT" ] && [ -f "$( dirname "$0" )/.env" ]; then
    PROJECT=$( grep -E '^COMPOSE_PROJECT_NAME=' "$( dirname "$0" )/.env" \
        | tail -1 | cut -d= -f2- )
fi

if [ -z "$PROJECT" ]; then
    echo "Name the compose project to load into. Running now:" >&2
    docker ps --filter "name=-db-1" --format '{{.Names}}' 2>/dev/null \
        | sed 's/-db-1$//; s/^/  /' >&2
    echo >&2
    echo "  ./load-backup.sh <project>" >&2
    exit 2
fi

CONTAINER="${PROJECT}-db-1"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "No running container named $CONTAINER." >&2
    echo "Start it first:  COMPOSE_PROJECT_NAME=$PROJECT docker compose up -d" >&2
    exit 1
fi

DB_NAME="${DB_NAME:-pickipedia}"
DB_USER="${DB_USER:-pickipedia}"
DB_PASSWORD="${DB_PASSWORD:-pickipedia_dev}"

LATEST_BACKUP=$( ls -t "${BACKUP_DIR}"/pickipedia_*.sql.gz 2>/dev/null | head -1 )
if [ -z "$LATEST_BACKUP" ]; then
    echo "No backup found in $BACKUP_DIR" >&2
    echo "Backups are created daily at 3:30am on maybelle and synced here." >&2
    exit 1
fi

echo "Waiting for MariaDB in $CONTAINER..."
for _ in $( seq 1 60 ); do
    if docker exec "$CONTAINER" mariadb -u "$DB_USER" -p"$DB_PASSWORD" \
            -e "SELECT 1" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done
if ! docker exec "$CONTAINER" mariadb -u "$DB_USER" -p"$DB_PASSWORD" \
        -e "SELECT 1" >/dev/null 2>&1; then
    echo "MariaDB in $CONTAINER never became ready." >&2
    exit 1
fi

# Look before overwriting. A preview with pages in it is somebody's work in
# progress until proven otherwise.
EXISTING=$( docker exec "$CONTAINER" mariadb -u "$DB_USER" -p"$DB_PASSWORD" \
    -N -B -e "SELECT COUNT(*) FROM page" "$DB_NAME" 2>/dev/null || echo 0 )
if [ "${EXISTING:-0}" -gt 0 ] && [ "$FORCE" -ne 1 ]; then
    echo "$CONTAINER already holds a wiki with $EXISTING pages." >&2
    echo "Loading a dump would replace it. If that is what you want:" >&2
    echo "  ./load-backup.sh $PROJECT --force" >&2
    exit 1
fi

echo "Loading $( basename "$LATEST_BACKUP" ) into $CONTAINER ($DB_NAME)"
gunzip -c "$LATEST_BACKUP" \
    | docker exec -i "$CONTAINER" mariadb -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME"

LOADED=$( docker exec "$CONTAINER" mariadb -u "$DB_USER" -p"$DB_PASSWORD" \
    -N -B -e "SELECT COUNT(*) FROM page" "$DB_NAME" 2>/dev/null || echo "?" )
echo "Done. $PROJECT now has production data: $LOADED pages."
echo "Run update.php if the preview is on a newer MediaWiki than production."
