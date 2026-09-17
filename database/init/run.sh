#!/bin/sh
# Applies database/init/*.sql in order. Idempotent - run on every start by the
# `db-init` service, after PostgreSQL reports healthy and before any application.
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${WAREHOUSE_DB_PASSWORD:?WAREHOUSE_DB_PASSWORD is required}"
: "${COURIER_DB_PASSWORD:?COURIER_DB_PASSWORD is required}"

dir="$(dirname "$0")"

# "already exists, skipping" on every start is noise, not news.
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

for file in "$dir"/[0-9][0-9]-*.sql; do
  echo "[db-init] applying $(basename "$file")"
  psql --no-psqlrc --quiet \
       -v ON_ERROR_STOP=1 \
       -v warehouse_password="$WAREHOUSE_DB_PASSWORD" \
       -v courier_password="$COURIER_DB_PASSWORD" \
       -v admin_password="${PLATFORM_ADMIN_PASSWORD:-admin123}" \
       -v merchant_password="${PLATFORM_MERCHANT_PASSWORD:-linked123}" \
       -f "$file"
done

echo "[db-init] database ready"
