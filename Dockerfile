FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/decimal/package.json packages/decimal/package.json
RUN npm ci --no-audit --no-fund
COPY apps ./apps
COPY packages ./packages
COPY scripts/build.mjs scripts/build.mjs
ARG APP_VERSION=development
ARG APP_COMMIT=unknown
ENV ORDERS_VERSION=$APP_VERSION ORDERS_COMMIT=$APP_COMMIT
RUN npm run build

FROM node:24.22.1-bookworm-slim
WORKDIR /opt/orders
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/dist/server.cjs ./server.cjs
USER node
ENV NODE_ENV=production ORDERS_DATA_DIR=/data ORDERS_CONFIG_PATH=/data/config ORDERS_HOST=0.0.0.0 ORDERS_PORT=8090 ORDERS_NO_BROWSER=1
VOLUME ["/data"]
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.ORDERS_PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "/opt/orders/server.cjs"]
