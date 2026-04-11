FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM base AS builder
ENV DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/hammer?schema=public
ENV AUTH_SESSION_SECRET=build_time_secret_value_with_more_than_32_chars
ENV AUTH_SESSION_TTL_HOURS=12
ENV E2E_BASE_URL=http://127.0.0.1:3000
ENV E2E_ADMIN_STORAGE_STATE=tests/e2e/.auth/admin.json
ENV E2E_CASHIER_STORAGE_STATE=tests/e2e/.auth/cashier.json
ENV E2E_ADMIN_USERNAME=supervisor.mga
ENV E2E_ADMIN_PASSWORD=ChangeMeNow!123
ENV E2E_CASHIER_USERNAME=caja.mga
ENV E2E_CASHIER_PASSWORD=ChangeMeNow!123
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run prisma:generate
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
CMD ["sh", "-c", "npm run start -- --hostname 0.0.0.0 --port ${PORT:-3000}"]
