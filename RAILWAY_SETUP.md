# RAILWAY_SETUP.md

## ⚠️ IMPORTANTE (orden obligatorio)

**Debes agregar PostgreSQL al proyecto Railway ANTES de hacer deploy del servicio web.**

Si haces deploy sin PostgreSQL, `DATABASE_URL` no estará disponible y Prisma fallará con `P1012`.

---

## Orden correcto de configuración en Railway

1. Crea el proyecto Railway.
2. Agrega el servicio **PostgreSQL** y espera estado **Running**.
3. Conecta tu repositorio GitHub al servicio web.
4. En el servicio web, configura variables de entorno requeridas.
5. Verifica que `DATABASE_URL` esté correctamente referenciada a PostgreSQL.
6. Ejecuta deploy/redeploy.

---

## Variables de entorno requeridas (servicio web)

```env
DATABASE_URL=<referencia al servicio PostgreSQL del proyecto>
AUTH_SESSION_SECRET=<valor único, 32+ caracteres>
AUTH_SESSION_TTL_HOURS=12
NODE_ENV=production
APP_ENV=production
```

### Variables opcionales

```env
E2E_BASE_URL=https://<tu-servicio>.up.railway.app
E2E_ADMIN_STORAGE_STATE=tests/e2e/.auth/admin.json
E2E_CASHIER_STORAGE_STATE=tests/e2e/.auth/cashier.json
E2E_ADMIN_USERNAME=supervisor.mga
E2E_ADMIN_PASSWORD=<solo-si-ejecutas-e2e>
E2E_CASHIER_USERNAME=caja.mga
E2E_CASHIER_PASSWORD=<solo-si-ejecutas-e2e>
```

> No uses `127.0.0.1` ni `localhost` en `DATABASE_URL` para Railway.

---

## Cómo verificar que `DATABASE_URL` está configurada

1. Railway → Servicio web → **Variables**.
2. Confirma que existe la clave `DATABASE_URL`.
3. Verifica que apunta al PostgreSQL del mismo proyecto (no localhost).
4. Ejecuta redeploy y revisa logs del pre-deploy:
   - `npm run railway:migrate`
   - validación y conexión a DB
   - `prisma migrate deploy` exitoso

---

## Estrategia de migraciones para Railway

Este proyecto usa pre-deploy robusto:

- `railway.json` ejecuta: `npm run railway:migrate`
- Script: `scripts/railway-migrate.sh`
- El script:
  - valida `DATABASE_URL`,
  - espera/reintenta conexión a PostgreSQL,
  - ejecuta `prisma migrate deploy` de forma controlada.

Comandos útiles manuales:

```bash
npm run prisma:generate
npm run prisma:migrate:status
npm run prisma:migrate:deploy
npm run seed
```

---

## Validación post-deploy

- `/health` devuelve `200`.
- Login funciona con usuario existente.
- `/api/auth/session` responde correctamente tras login.
- Si aplica, el flujo de cambio de contraseña forzado funciona en `/app/change-password`.

---

## Si algo falla

Consulta `RAILWAY_TROUBLESHOOTING.md` para diagnóstico guiado de:
- `DATABASE_URL` faltante,
- conectividad PostgreSQL,
- variables no disponibles en deploy,
- errores de build/pre-deploy/runtime.
