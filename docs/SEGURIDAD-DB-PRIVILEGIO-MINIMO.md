# Privilegio mínimo en la conexión a base de datos (Neon)

**Estado: PENDIENTE DE APLICAR** — requiere acceso al panel de Neon (SQL Editor
o `psql` con el rol owner). Este documento es el runbook completo: qué roles
crear, con qué permisos, y cómo verificar. Ningún cambio de código es
necesario; solo variables de entorno en Vercel.

## Por qué

Hoy `DATABASE_URL` usa el rol owner que Neon crea por defecto. Si ese secreto
se filtra, el atacante puede hacer `DROP TABLE`, `ALTER`, crear roles, etc.
Con un rol de aplicación acotado a DML, el radio de daño de una filtración se
reduce a leer/modificar datos (grave, pero recuperable con backups/PITR de
Neon), nunca a destruir el esquema.

## Diseño: dos roles

| Rol             | Uso                                    | Permisos                                          | Variable en Vercel |
|-----------------|----------------------------------------|---------------------------------------------------|--------------------|
| `hammer_app`    | Runtime de la app (Prisma Client)      | `SELECT, INSERT, UPDATE, DELETE` sobre tablas de la app; `USAGE` en secuencias | `DATABASE_URL` (pooled) |
| `hammer_migrate`| Solo `prisma migrate deploy` en el build | DDL: `CREATE/ALTER/DROP` dentro del schema `public` | `DIRECT_URL` (directa) |

`prisma migrate deploy` corre en `vercel-build` (ver `hammer-api/package.json`)
y necesita DDL — por eso NO puede usar `hammer_app`. Prisma usa `DIRECT_URL`
para migraciones (ver `datasource` en `prisma/schema.prisma`) y `DATABASE_URL`
para runtime, así que la separación mapea 1:1 con variables ya existentes.

## SQL (ejecutar como owner en el SQL Editor de Neon)

```sql
-- 1. Rol de runtime (DML únicamente)
CREATE ROLE hammer_app WITH LOGIN PASSWORD '<GENERAR_PASSWORD_FUERTE_1>';
GRANT CONNECT ON DATABASE neondb TO hammer_app;          -- ajustar nombre de BD
GRANT USAGE ON SCHEMA public TO hammer_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hammer_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hammer_app;

-- 2. Rol de migraciones (DDL dentro de public)
CREATE ROLE hammer_migrate WITH LOGIN PASSWORD '<GENERAR_PASSWORD_FUERTE_2>';
GRANT CONNECT ON DATABASE neondb TO hammer_migrate;
GRANT USAGE, CREATE ON SCHEMA public TO hammer_migrate;
-- prisma migrate necesita ser dueño (o miembro del dueño) de las tablas que altera:
-- opción recomendada en Neon: hacer a hammer_migrate miembro del rol owner actual
-- de las tablas (p.ej. neondb_owner):
GRANT neondb_owner TO hammer_migrate;                    -- ajustar al owner real

-- 3. Que las tablas creadas por futuras migraciones hereden los grants DML:
ALTER DEFAULT PRIVILEGES FOR ROLE hammer_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hammer_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hammer_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hammer_app;
```

Notas:
- `hammer_app` NO recibe `CREATE` en el schema ni permisos de superusuario.
- La tabla `_prisma_migrations` la escribe `hammer_migrate` (durante deploy);
  `hammer_app` no la necesita.
- Prisma Client en runtime no necesita introspección de `pg_catalog` más allá
  de lo que `USAGE` en `public` ya permite.

## Cambios en Vercel (nunca en el repo)

1. `DATABASE_URL` (hammer-api) → connection string **pooled** de Neon con
   `hammer_app` y su password.
2. `DIRECT_URL` (hammer-api) → connection string **directa** con
   `hammer_migrate`.
3. Redeploy de hammer-api: el build corre `prisma migrate deploy` con
   `hammer_migrate` y el runtime queda con `hammer_app`.

## Verificación (staging primero)

```sql
-- Conectado como hammer_app, esto DEBE fallar por permisos:
DROP TABLE "AuditLog";          -- ERROR: must be owner of table
CREATE TABLE hack (id int);     -- ERROR: permission denied for schema public

-- Y esto debe funcionar:
SELECT count(*) FROM "User";
```

Después del cambio, probar el flujo completo en staging: login → venta →
pago → cierre de caja, y un deploy con una migración trivial para validar
`hammer_migrate`.

## Rotación

Si se sospecha filtración de `DATABASE_URL`: `ALTER ROLE hammer_app WITH
PASSWORD '<nueva>'` + actualizar la env en Vercel + redeploy. El rol owner
nunca viaja en las envs de la app.
