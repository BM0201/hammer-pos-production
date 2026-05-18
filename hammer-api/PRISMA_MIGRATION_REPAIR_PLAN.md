# Prisma — Plan de Migración y Estado Actual

## Estado

✅ **Consolidación completada.** El schema Prisma y las migraciones están estabilizados para PostgreSQL.

---

## Fuente de Verdad

`prisma/schema.prisma` (1254 líneas) es la fuente de verdad del modelo de datos. Incluye todos los modelos, enums, relaciones, índices, `sessionVersion`, `BranchModuleConfig`, y los modelos del motor de reorden.

---

## Cadena de Migraciones Activa

| # | Migración | Descripción |
|---|-----------|-------------|
| 1 | `20260518000000_current_postgresql_baseline` | Baseline generado desde `schema.prisma` con `prisma migrate diff --from-empty`. Contiene todos los modelos actuales. |
| 2 | `20260518001000_payment_one_posted_per_sale_order` | Índice único parcial PostgreSQL: `Payment_one_posted_per_sale_order` (no modelable directamente en Prisma). |

---

## Migraciones Archivadas

Las migraciones anteriores están en `prisma/migrations_archived/` como referencia histórica. No deben restaurarse a `prisma/migrations/` — contenían una mezcla de SQL SQLite, baselines PostgreSQL duplicados y migraciones incrementales ya incluidas en el baseline actual.

---

## Comandos de Producción

### Base de datos nueva (vacía)

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
```

### Base de datos existente (ya tiene el schema)

Si la base de datos de producción ya coincide con `schema.prisma`, marcar el baseline como aplicado sin ejecutarlo:

```bash
# 1. Verificar el estado de migraciones
npx prisma migrate status

# 2. Si el schema ya coincide, marcar como aplicado
npx prisma migrate resolve --applied 20260518000000_current_postgresql_baseline
npx prisma migrate deploy
```

> **Importante:** Solo usar `migrate resolve` después de verificar que el schema en producción coincide con `schema.prisma`.

---

## Reglas

- ✅ Usar solo PostgreSQL
- ✅ Usar `prisma migrate deploy` en producción
- ✅ Mantener migraciones archivadas como referencia
- ❌ No usar SQLite
- ❌ No usar `prisma db push` en producción
- ❌ No hacer reset ni drop de bases de datos de producción
