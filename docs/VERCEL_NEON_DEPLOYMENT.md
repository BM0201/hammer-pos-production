# H.A.M.M.E.R. Vercel + Neon Deployment

## Architecture

- Neon: one PostgreSQL database.
- Vercel project 1: `hammer-api`, with Root Directory set to `hammer-api`.
- Vercel project 2: `hammer-frontend`, with Root Directory set to `hammer-frontend`.

Deploy the apps as two independent Vercel projects. Do not merge them into a single app.

## Backend Variables

Configure these in the `hammer-api` Vercel project:

- `DATABASE_URL`: pooled Neon PostgreSQL connection for runtime.
- `DIRECT_URL`: direct Neon PostgreSQL connection for `prisma migrate deploy`.
- `AUTH_SESSION_SECRET`: strong secret, minimum 32 characters.
- `AUTH_SESSION_TTL_HOURS`: session lifetime in hours.
- `CRON_SECRET`: secret expected by Vercel Cron endpoints in the `Authorization` header.
- `PRISMA_USE_NEON_ADAPTER`: set to `true` when using Neon in production.
- `ENABLE_CASH_CLOSURE_SCHEDULER`: set to `false` on Vercel because Vercel Cron triggers the endpoint.
- `APP_ENV`: deployment environment label, for example `production`.

The backend Vercel configuration should use:

- Root Directory: `hammer-api`
- Install Command: `npm install`
- Build Command: `npm run vercel-build`
- Framework Preset: Next.js

`npm run vercel-build` runs Prisma generate, Prisma migrate deploy, and Next.js build. Do not add production seed commands to the build.

## Frontend Variables

Configure these in the `hammer-frontend` Vercel project:

- `BACKEND_URL`: public URL of the deployed backend Vercel project, without a trailing slash.
- `NEXT_PUBLIC_SITE_URL`: public URL of the deployed frontend Vercel project.

Example:

```env
BACKEND_URL="https://hammer-api.vercel.app"
NEXT_PUBLIC_SITE_URL="https://hammer-frontend.vercel.app"
```

Do not configure database variables in the frontend project. The frontend rewrites `/api/*` requests to `BACKEND_URL`.

## Vercel Cron

The backend project defines the cash auto-close cron at:

```text
/api/system/cron/cash-auto-close
```

The middleware allows `/api/cron/*` and `/api/system/cron/*` to skip session and CSRF checks. These endpoints are still protected by the route handler, which must validate:

```text
Authorization: Bearer <CRON_SECRET>
```

## Manual Seed

Run the production seed manually from `hammer-api` only when bootstrapping the environment:

```bash
npm run db:seed:prod
```

Do not run seeds during Vercel build.

`MASTER_INITIAL_USERNAME` and `MASTER_INITIAL_PASSWORD` are only for the initial master bootstrap. `BOOTSTRAP_*` variables are also only for manual bootstrap seed execution.

## Post-Deploy Checks

After deploying both projects, verify:

- `GET /health`
- `GET /ready`
- Master login
- Mandatory password change
- Open operational day
- Open cash box
- POS sale
- Payment collection
- Cash box close
- Operational day close
