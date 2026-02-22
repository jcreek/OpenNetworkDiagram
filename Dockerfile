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

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner

USER root

RUN apk add --no-cache libcap && \
	setcap 'cap_net_bind_service=+ep' /usr/sbin/nginx

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/build /usr/share/nginx/html

RUN mkdir -p /usr/share/nginx/html/data && \
	chown -R 101:101 /usr/share/nginx/html /var/cache/nginx /var/run /etc/nginx/conf.d

USER 101

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
	CMD wget -qO- http://127.0.0.1/ > /dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
