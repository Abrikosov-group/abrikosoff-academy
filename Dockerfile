# syntax=docker/dockerfile:1.7

FROM node:26.7.0-alpine3.23@sha256:ce3cc39fe3b8b2602d3b1c4d63d301e46b48c550ecb627869853ddcdda418b63 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --strict-allow-scripts

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:26.7.0-alpine3.23@sha256:ce3cc39fe3b8b2602d3b1c4d63d301e46b48c550ecb627869853ddcdda418b63 AS runner
WORKDIR /app

ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs \
  && mkdir -p /app/.next/cache \
    && chown -R nextjs:nodejs /app

COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/db ./db
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=root:root --chmod=0555 \
  /app/deploy/server/academy-admin \
  /app/deploy/server/academy-release \
  /app/deploy/server/academy-task \
  /usr/local/share/academy/
RUN install -d \
  --owner=root \
  --group=root \
  --mode=0555 \
  /usr/local/share/academy/systemd
COPY --from=builder --chown=root:root --chmod=0444 \
  /app/deploy/systemd/academy-identity-session-retention.service \
  /usr/local/share/academy/systemd/academy-identity-session-retention.service
COPY --from=builder --chown=root:root --chmod=0444 \
  /app/deploy/systemd/academy-identity-session-retention.timer \
  /usr/local/share/academy/systemd/academy-identity-session-retention.timer

USER nextjs

EXPOSE 3000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
