#!/usr/bin/env bash
set -euo pipefail

echo "[entrypoint] running migrations..."
alembic upgrade head

echo "[entrypoint] seeding reference data..."
python -m app.db.seed

echo "[entrypoint] starting uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
