# syntax=docker/dockerfile:1.7
# =============================================================================
# Courier (J&T) API - FastAPI.
#
# On start: Alembic migrates the courier schema, reference data is seeded
# (idempotent), then Uvicorn serves behind the platform gateway.
# =============================================================================
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DEFAULT_TIMEOUT=30 \
    PIP_RETRIES=10

WORKDIR /app

COPY requirements.txt .
# python:3.11-slim ships an old pip that cannot read the metadata of some of the
# pinned wheels ("No matching distribution found for pydantic-core").
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip \
 && pip install -r requirements.txt

COPY . .

# A Windows build context carries no Unix mode bits, so set them here; and the
# app runs as an unprivileged user that owns only its output folders.
RUN chmod +x ./entrypoint.sh \
 && useradd --system --uid 10001 --home-dir /app courier \
 && mkdir -p /data/waybills /data/whatsapp/outbox \
 && chown -R courier /data /app

USER courier
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=4).status == 200 else 1)"

CMD ["./entrypoint.sh"]
