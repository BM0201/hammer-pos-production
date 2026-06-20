# H.A.M.M.E.R. — Guía de Deployment / Activación V2

Esta guía deja el sistema **100% funcional** con el módulo **Hierro** visible y operativo,
y todos los flujos V2 (POS / Caja / Cobros / Usuarios) activos por defecto.

> Todos los comandos de backend se ejecutan dentro de `hammer-api/`.

## 0. Requisitos

- Node.js 20+ (probado con v22).
- PostgreSQL 15+ (local) o Neon (producción).
- Variables de entorno (`hammer-api/.env`):
  ```env
  DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require"
  DIRECT_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require"
  # Solo en Neon/producción con pooler:
  # PRISMA_USE_NEON_ADAPTER=true
  ```

## 1. Instalar dependencias

```bash
cd hammer-api
npm install            # ejecuta `prisma generate` automáticamente (postinstall)
```

## 2. Aplicar migraciones

```bash
npx prisma migrate deploy
```

Esto aplica, entre otras, las migraciones V2:
- `20260608193000_cash_pos_v2` → modelos `CashSessionOperator`, `CashMovement`, `PaymentTender`
  y columnas nuevas de `BranchModuleConfig` (`paymentWorkflowMode`, `dispatchWorkflowMode`, …).

> **Nota (Corrección 3):** la categoría física **"Hierro"** NO se crea por migración ni por seed.
> Se crea **manualmente** en producción desde `/app/master`; los productos de hierro se agrupan
> con el endpoint MASTER `POST /api/catalog/stock-groups/bootstrap-iron`. La lógica de conversión
> quintal/varilla vive en `unit-conversion.ts` y se mantiene intacta.

Verifica el estado:
```bash
npx prisma migrate status
```

## 3. Ejecutar el seed (datos iniciales)

```bash
npm run seed
# alternativa equivalente:
npx prisma db seed
```

El seed es **idempotente** (se puede correr varias veces) y crea:
- Sucursal **Managua Central (MGA)** + caja física + usuario **master**.
- Sucursal **Masaya Central (MSY)** con `BranchModuleConfig` en modo **HYBRID**.
- Caja física **"Caja Principal Masaya"**.
- Usuarios de prueba (todos en MSY):

  | Usuario | Perfil | Contraseña |
  |---------|--------|-----------|
  | `master` | MASTER (global) | Se obtiene ejecutando `npx tsx scripts/reset-master-password.ts` |
  | `vendedor` | SALES | `Hammer1234!` |
  | `cajero` | CASHIER | `Hammer1234!` |
  | `vendedor-cajero` | SALES + CASHIER | `Hammer1234!` |
  | `admin-sucursal` | BRANCH_ADMIN | `Hammer1234!` |

> **Contraseñas de desarrollo** — en producción, ejecuta `npx tsx scripts/reset-master-password.ts`
> para generar una contraseña temporal única. La contraseña se muestra **una sola vez** en consola.
> El master deberá cambiarla en su primer login (`mustChangePassword: true`).

## 4. Crear la categoría Hierro y agrupar productos (manual, producción)

La categoría física **"Hierro"** se crea **manualmente** desde `/app/master` (no por seed ni
migración). Una vez que existan productos con nombres `HIERRO …` / `VARILLA HIERRO …`,
agrúpalos en stock compartido con el endpoint (requiere rol MASTER):

```bash
# Dry-run (no modifica nada):
POST /api/catalog/stock-groups/bootstrap-iron   { "apply": false }
# Aplicar:
POST /api/catalog/stock-groups/bootstrap-iron   { "apply": true }
```

## 5. Rebuild / arranque

Desarrollo:
```bash
# Backend (puerto 4000)
cd hammer-api && npm run dev
# Frontend (en otra terminal)
cd hammer-frontend && npm install && npm run dev
```

Producción (backend en Vercel):
```bash
cd hammer-api && npm run build && npm run start
```
> `vercel-build` ya ejecuta `prisma generate && prisma migrate deploy && next build`.

## 6. Verificación de funcionalidad

```bash
cd hammer-api && npm test         # 75 pruebas (RBAC, workflow, conversión hierro, …)
npm run typecheck                 # tsc --noEmit
```

Checklist visual rápido:
1. Login como `master` → tras crear manualmente la categoría **Hierro** y agrupar los productos, el **Catálogo** debe mostrarlos.
2. Login como `vendedor` en MSY → POS muestra **"Enviar a caja"** (sin "Cobrar aquí").
3. Login como `cajero` → ve la **cola de cobros** y puede cobrar.
4. Login como `vendedor-cajero` con caja abierta y asignado → ve **"Cobrar aquí"** habilitado.
5. Al vender **VARILLA HIERRO 3/8**, el stock se descuenta del grupo compartido `HIERRO_3_8`.

## 7. Nota sobre el entorno

> El localhost mencionado corresponde a la máquina donde se ejecuta la aplicación.
> En producción usa las URLs públicas del despliegue (Vercel / tu servidor).
