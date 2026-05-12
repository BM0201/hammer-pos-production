FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat \
  && corepack enable \
  && corepack prepare npm@11.4.2 --activate
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM base AS builder
ARG BUILD_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/hammer?schema=public"
ARG BUILD_AUTH_SESSION_SECRET="build_time_secret_value_with_more_than_32_chars_123456"
ENV DATABASE_URL=${BUILD_DATABASE_URL}
ENV AUTH_SESSION_SECRET=${BUILD_AUTH_SESSION_SECRET}
ENV AUTH_SESSION_TTL_HOURS=12
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/postcss.config.mjs ./postcss.config.mjs
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/next-env.d.ts ./next-env.d.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/.env.example ./.env.example
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "run", "start:railway"]
