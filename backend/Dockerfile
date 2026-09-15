FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# python:3.11-slim ships pip 24.0, which cannot read the metadata on some of the
# pinned wheels ("No matching distribution found for pydantic-core").
# The retry/timeout settings keep the build from hanging indefinitely on a slow
# or flaky link instead of failing fast and retrying.
ENV PIP_DEFAULT_TIMEOUT=30 \
    PIP_RETRIES=10
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

COPY . .

# A Windows build context carries no Unix mode bits, so set them here.
RUN chmod +x ./entrypoint.sh \
 && mkdir -p /data/waybills

EXPOSE 8000
CMD ["./entrypoint.sh"]
