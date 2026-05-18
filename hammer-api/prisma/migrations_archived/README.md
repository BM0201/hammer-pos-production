# Migraciones Archivadas

Estas migraciones fueron removidas de la cadena activa de Prisma durante la consolidación del schema a PostgreSQL.

**¿Por qué están archivadas?**
- La historia previa mezclaba SQL SQLite con PostgreSQL
- Existían baselines duplicados
- Las migraciones incrementales ya están incluidas en el baseline consolidado actual

**No restaurar** estas carpetas a `prisma/migrations/` a menos que sea necesario reconstruir un entorno de base de datos antiguo.

Las migraciones activas de producción están en `../migrations/`.

Para más detalles, consultar [`PRISMA_MIGRATION_REPAIR_PLAN.md`](../../PRISMA_MIGRATION_REPAIR_PLAN.md).
