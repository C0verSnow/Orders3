# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm AS builder
WORKDIR /build
COPY pyproject.toml README.md ./
COPY src ./src
RUN python -m pip wheel --no-cache-dir --wheel-dir /wheels .

FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ORDERS_DATA_DIR=/data \
    ORDERS_CONFIG_PATH=/data/config
WORKDIR /app
COPY --from=builder /wheels /wheels
RUN python -m pip install --no-cache-dir --no-index --find-links=/wheels orders-dashboard \
    && rm -rf /wheels \
    && useradd --create-home --uid 10001 orders \
    && mkdir /data && chown orders:orders /data
USER orders
VOLUME ["/data"]
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/api/data', timeout=3).read()"
ENTRYPOINT ["python", "-m", "orders_dashboard"]
CMD ["--host", "0.0.0.0", "--port", "8090", "--no-browser"]
