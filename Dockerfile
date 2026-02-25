FROM node:20-alpine AS builder

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --store-dir /pnpm/store

COPY . .

ENV DEPLOY_TARGET=docker
RUN pnpm run build:docker

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

RUN addgroup -S appuser && adduser -S -G appuser appuser

COPY --from=builder /app/build ./build
COPY --from=builder /app/server.mjs ./server.mjs
COPY --from=builder /app/src/lib/shared ./src/lib/shared
COPY --from=builder /app/data ./data

RUN chown -R appuser:appuser /app/build /app/server.mjs /app/data /app \
	&& chmod -R u+rwX /app /app/data

EXPOSE 3000

USER appuser

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
	CMD wget -qO- http://127.0.0.1:3000/ > /dev/null || exit 1

CMD ["node", "server.mjs"]
