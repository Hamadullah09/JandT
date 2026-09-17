#!/usr/bin/env bash
set -euo pipefail

echo "[entrypoint] running migrations (schema ${JT_DB_SCHEMA:-courier})..."
alembic upgrade head

echo "[entrypoint] seeding reference data..."
python -m app.db.seed

echo "[entrypoint] starting uvicorn..."
# Behind the platform gateway: trust its X-Forwarded-* headers for the client's
# address and scheme.
exec uvicorn app.main:app \
  --host 0.0.0.0 --port 8000 \
  --workers "${UVICORN_WORKERS:-1}" \
  --proxy-headers --forwarded-allow-ips "*" \
  --no-server-header
