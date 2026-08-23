# Malica — one Python process (stdlib + gunicorn). No build step, no database.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# tzdata: zoneinfo for Europe/Ljubljana (deadlines); curl: healthcheck
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata curl \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --quiet gunicorn==23.0.0 \
 && useradd -r -u 1000 -d /app -s /usr/sbin/nologin malica

WORKDIR /app
COPY app.py ./
COPY malica/ ./malica/
COPY static/ ./static/

# Runtime state lives in /app/data (bind-mounted); the cookie-signing secret goes there too,
# so rebuilding the image does not log everyone out.
ENV MALICA_SECRET_FILE=/app/data/.secret
RUN mkdir -p /app/data && chown -R malica:malica /app
USER malica
VOLUME ["/app/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD curl -fsS http://127.0.0.1:8000/manifest.json -o /dev/null || exit 1

CMD ["gunicorn", "--workers", "1", "--threads", "8", "--bind", "0.0.0.0:8000", \
     "--access-logfile", "-", "--error-logfile", "-", "app:application"]
