# RAILWAY_SETUP.md

## Orden recomendado

1. Crear proyecto Railway.
2. Agregar servicio PostgreSQL.
3. Conectar repo del servicio web.
4. Configurar variables de entorno.
5. Desplegar y validar `/health`.

## Variables requeridas

```env
DATABASE_URL=<referencia PostgreSQL Railway>
AUTH_SESSION_SECRET=<32+ chars>
AUTH_SESSION_TTL_HOURS=12
NODE_ENV=production
APP_ENV=production
ENABLE_CASH_CLOSURE_SCHEDULER=false
```

Variables E2E opcionales:

```env
E2E_BASE_URL=https://<tu-app>.up.railway.app
E2E_ADMIN_EMAIL=supervisor.mga@hammer.local
E2E_ADMIN_PASSWORD=<solo testing>
E2E_CASHIER_EMAIL=caja.mga@hammer.local
E2E_CASHIER_PASSWORD=<solo testing>
```

## Comandos usados por Railway

- `preDeployCommand`: `npm run railway:migrate`
- `startCommand`: `npm run start:railway`
- `healthcheckPath`: `/health`

## Validación operativa

- `/health` responde `200` sin autenticación
- `/app` carga
- login funciona
- caja y pagos funcionan con sesión explícita

## Migraciones y bootstrap

```bash
npm run railway:migrate
npm run seed:production   # solo cuando corresponda bootstrap inicial
```

## Troubleshooting rápido

- Error `P1012`: falta `DATABASE_URL`.
- Error de sesión: `AUTH_SESSION_SECRET` inválido o corto.
- Pantalla en blanco: validar build + env + migraciones y revisar logs del deploy.
