# H.A.M.M.E.R. V3 E2E operacional

Suite minima de produccion para validar jornada operativa, caja, pagos, permisos e importacion de Catalogo/Inventario.

## Variables necesarias

- `DATABASE_URL`: PostgreSQL de test.
- `DIRECT_URL`: conexion directa PostgreSQL para Prisma.
- `AUTH_SESSION_SECRET`: secreto de sesion. Si no se define, Playwright usa uno local de E2E.
- `CRON_SECRET`: secreto del cron. Si no se define, Playwright usa `e2e-cron-secret`.
- `E2E_API_URL`: opcional, por defecto `http://127.0.0.1:4000`.

No apuntar esta suite a produccion. El seed usa datos controlados con prefijo `E2E-*` y reinicia solo esos datos operativos.

## Preparacion

Desde `hammer-api`:

```bash
npm install
npm run prisma:generate
npm run prisma:validate
```

Desde `hammer-frontend`:

```bash
npm install
```

## Ejecucion

Desde `hammer-frontend`:

```bash
npm run test:e2e
```

Modo interactivo:

```bash
npm run test:e2e:ui
```

El script entra a `hammer-api`, ejecuta `prisma/e2e-seed.ts`, genera `hammer-frontend/tests/e2e/.e2e-state.json`, levanta `hammer-api` en `:4000` y corre Playwright.

## Usuarios E2E

- MASTER: `e2e_master`
- Cajero/Vendedor: `e2e_cashier`
- Password por defecto: `E2eHammer1234!`

Se puede cambiar con:

- `E2E_MASTER_USERNAME`
- `E2E_CASHIER_USERNAME`
- `E2E_PASSWORD`

## Flujos cubiertos

- Login MASTER y cajero.
- Apertura de `OperationalDay`.
- Apertura de `CashSession`.
- Creacion de orden POS por API, envio a caja y cobro.
- Cierre manual de caja y cierre de dia.
- Auto-cierre via cron con `now` de test, bloqueo de pago y revision humana.
- Permisos: cajero no entra a rutas MASTER y no cierra `OperationalDay`; MASTER si.
- Importacion: preview, ejecucion por `batchId`, bloqueo de segunda ejecucion.

## Validacion completa previa a release

```bash
cd hammer-api
npm run prisma:generate
npm run prisma:validate
npm run typecheck
npm run build

cd ../hammer-frontend
npm run typecheck
npm run build
npm run test:e2e
```
