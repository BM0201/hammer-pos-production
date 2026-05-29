# H.A.M.M.E.R. V3 Production Readiness

## Estado del build

- Backend: debe pasar `npm install`, `npm run prisma:generate`, `npm run prisma:validate`, `npm run typecheck`, `npm run build`.
- Frontend: debe pasar `npm install`, `npm run typecheck`, `npm run build`.
- Warnings frontend restantes son deuda de lint en modulos no criticos de release; caja, pagos, POS e inventario fueron limpiados de warnings operativos principales.

## Variables necesarias

Backend en Vercel:

- `DATABASE_URL`: PostgreSQL pooled/runtime. Obligatoria en produccion.
- `DIRECT_URL`: conexion directa para Prisma migrate si el proveedor lo requiere.
- `AUTH_SESSION_SECRET`: minimo 32 caracteres, sin placeholders.
- `AUTH_SESSION_TTL_HOURS`: entero >= 1. Sugerido: `12`.
- `PRISMA_USE_NEON_ADAPTER`: `true` solo si se usa Neon serverless adapter.
- `CRON_SECRET`: secreto requerido por `/api/system/cron/cash-auto-close`.
- `NODE_ENV=production`.
- `APP_ENV=production`.

Frontend:

- `BACKEND_URL`: URL publica/privada del backend si se despliega frontend separado.
- `NEXT_PUBLIC_SITE_URL`: URL publica del frontend.

La validacion actual del backend exige `DATABASE_URL` y `AUTH_SESSION_SECRET` en runtime productivo. `DIRECT_URL`, `CRON_SECRET` y `APP_ENV` se documentan como obligatorias operativas aunque no todas bloquean build.

## Migraciones

- No usar SQLite.
- Ejecutar migraciones contra PostgreSQL.
- Build recomendado backend: `npx prisma generate && npx prisma migrate deploy && next build`.
- `DATABASE_URL` debe existir durante build.
- `DIRECT_URL` debe existir si Prisma/provider lo requiere para migraciones.
- Revisar estado con `npm run prisma:migrate:status` antes de promover produccion.

## Seed inicial

- Produccion: usar `npm run db:seed:prod` solo en base nueva.
- Desarrollo/local: `npm run db:seed`.
- E2E: usar `hammer-api/prisma/e2e-seed.ts` solo contra DB de test.
- No cargar datos demo en produccion.

## Usuarios

- Crear usuario MASTER inicial.
- Cambiar password inicial inmediatamente.
- Asignar cajeros/vendedores por sucursal.
- Validar que usuarios normales no accedan rutas MASTER.

## Sucursales

- Confirmar sucursal activa.
- Confirmar configuracion de modulos por sucursal: caja/despacho.
- Confirmar roles efectivos de cada usuario por sucursal.

## Caja

- Crear caja fisica activa por sucursal.
- Validar apertura de `CashSession` solo con `OperationalDay OPEN`.
- Validar cierre manual sin ordenes pendientes.
- Validar que caja auto-cerrada queda `AUTO_CLOSED_PENDING_REVIEW`.

## Dia operativo

- `OperationalDay` es la fuente principal del dia.
- No cerrar dia con cajas abiertas o auto-cerradas pendientes de revision.
- MASTER puede forzar cierre solo con nota y aceptando riesgos.

## Cron

- Vercel cron configurado en `hammer-api/vercel.json`: cada 5 minutos.
- Endpoint: `/api/system/cron/cash-auto-close`.
- Requiere `Authorization: Bearer ${CRON_SECRET}`.
- `dryRun=1` no modifica base.
- `now=` solo funciona fuera de produccion.
- Horario efectivo:
  - Lunes a viernes: despues de 17:20 America/Managua.
  - Sabado: despues de 16:00 America/Managua.
  - Domingo: desactivado.

## Backup

- Tomar backup antes de `prisma migrate deploy`.
- Confirmar restauracion en staging.
- Mantener snapshot previo al release.

## Rollback

- Rollback de app: promover deployment anterior en Vercel.
- Rollback de DB: restaurar backup/snapshot. No intentar revertir migraciones manualmente sin plan.
- Si el importador ya ejecuto movimientos, revertir con movimientos inversos auditados, no editando balances a mano.

## Pruebas manuales

- Login MASTER.
- Abrir dia operativo.
- Abrir caja.
- Crear venta POS.
- Enviar a caja.
- Cobrar.
- Cerrar caja manual.
- Cerrar dia.
- Ejecutar cron dry-run.
- Revisar auto-cierre pendiente en staging.
- Importar CSV pequeno: preview, execute, bloqueo de segunda ejecucion.
- Revisar Brain: `MANUAL_REVIEW`, `EXECUTED`, `FAILED`.

## Pruebas E2E

Desde `hammer-frontend`:

```bash
npm run test:e2e
```

Requiere DB PostgreSQL de test con `DATABASE_URL` y `DIRECT_URL`. La suite cubre login, jornada, caja, pago, cierre, auto-cierre, permisos e import batch.

## Riesgos conocidos

- Frontend conserva warnings de lint en modulos no criticos: analytics, reorder, transfers, algunos dashboards y navegacion.
- `npm audit` puede reportar dependencias transitivas; no usar `npm audit fix --force` sin prueba completa.
- `DIRECT_URL` debe revisarse segun proveedor PostgreSQL.
- Cron depende de reloj de Vercel y de que el endpoint tenga `CRON_SECRET`.
- E2E no debe apuntar a produccion porque crea datos `E2E-*`.
