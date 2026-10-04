# syntax=docker/dockerfile:1
FROM ubuntu:24.04 AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates g++ cmake ninja-build qt6-base-dev qt6-httpserver-dev qt6-websockets-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY CMakeLists.txt resources.qrc ./
COPY src ./src
COPY web ./web
COPY example.env example.config README.md ./
COPY docs ./docs
RUN cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF -DCMAKE_INSTALL_LIBDIR=lib \
    && cmake --build build --parallel 2 \
    && cmake --install build --prefix /opt/orders

FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl libqt6core6t64 libqt6network6t64 libqt6sql6t64 \
    libqt6sql6-sqlite libqt6concurrent6t64 libqt6httpserver6 libqt6websockets6 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 orders \
    && mkdir /data && chown orders:orders /data
COPY --from=builder /opt/orders /opt/orders
ENV ORDERS_DATA_DIR=/data \
    ORDERS_CONFIG_PATH=/data/config \
    ORDERS_HOST=0.0.0.0 \
    ORDERS_PORT=8090 \
    ORDERS_NO_BROWSER=1
WORKDIR /opt/orders/bin
USER orders
VOLUME ["/data"]
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8090/api/data > /dev/null || exit 1
ENTRYPOINT ["/opt/orders/bin/orders"]
CMD []
