# Credenciales de bootstrap — H.A.M.M.E.R.

> ⚠️ **SOLO DESARROLLO / STAGING — NO USAR EN PRODUCCIÓN**

Este documento describe cómo se gestionan credenciales de prueba.
No publiques contraseñas reales ni reutilices estas cuentas fuera de entornos controlados.

## Fuente de verdad

- Seed demo/staging: `prisma/seed.ts`
- Seed productivo mínimo: `prisma/seed-production.ts`

## Contraseñas en demo/staging

La contraseña demo ya no se hardcodea en documentación pública.
Se toma desde variables de entorno:

- `E2E_BOOTSTRAP_PASSWORD` (prioridad 1)
- `TEST_USER_PASSWORD` (prioridad 2)
- fallback local de desarrollo (solo para entorno interno)

## Cuentas demo esperadas (usernames)

- `propietario`
- `master`
- `supervisor.mga`, `vendedor.mga`, `caja.mga`, `bodega.mga`
- `supervisor.msy`, `vendedor.msy`, `caja.msy`, `bodega.msy`
- `supervisor.riv`, `vendedor.riv`, `caja.riv`, `bodega.riv`

> Para E2E se recomienda usar variables `E2E_ADMIN_EMAIL`, `E2E_CASHIER_EMAIL` y sus passwords.

## Reset de credenciales demo

```bash
npm run password:reset:bootstrap -- "TuPasswordTemporalSegura!123"
```

## Producción

No usar `seed.ts` para bootstrap productivo.
Usar:

```bash
npm run seed:production
```

con estas variables obligatorias:

- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`
- `BOOTSTRAP_ADMIN_NAME`
- `BOOTSTRAP_BRANCH_CODE`
- `BOOTSTRAP_BRANCH_NAME`
