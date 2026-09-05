#!/bin/sh
# Make the data directory writable by the user the server runs as, then become
# that user.
#
# This exists because of the upgrade from the PHP version. That image ran as
# www-data (uid 33) and left the tournament database owned by it. This one runs
# as node (uid 1000), so without fixing the ownership the server starts, opens
# the database, and dies with "attempt to write a readonly database" — which
# reads like a corrupt file rather than a permissions problem, and would be a
# miserable thing to debug at a venue.
#
# On a fresh install the directory is already owned correctly and the chown is
# a no-op.
set -e

DATA_DIR="$(dirname "${CROK_DB_PATH:-/data/crok.sqlite}")"
mkdir -p "$DATA_DIR"

if [ "$(id -u)" = "0" ]; then
    chown -R node:node "$DATA_DIR"
    exec su-exec node "$@"
fi

exec "$@"
