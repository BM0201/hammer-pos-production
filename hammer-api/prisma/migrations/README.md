# Migraciones

## Diferencias conocidas con `prisma migrate diff`

Al comparar producción contra `schema.prisma` (`prisma migrate diff --from-url <prod> --to-schema-datamodel schema.prisma --script`), quedan dos diferencias que **no son drift real** — se investigaron a fondo (prompt-migraciones-rebaseline.md, 2026-10-22) y se dejan así a propósito. `migrate deploy` no ejecuta este diff, así que ninguna de las dos bloquea un despliegue.

- **`BrainDecision_idempotencyKey_key`**: en producción es un índice único **parcial** (`WHERE "idempotencyKey" IS NOT NULL`), creado por `20260525133000_brain_decision_center_v2`. Prisma no tiene forma de declarar un índice único parcial en `schema.prisma` — el `@unique` que sí puede declarar genera un índice único simple, que el diff ve como "falta crear". Es funcionalmente equivalente (Postgres ya trata los NULL de una columna única como no-duplicados, igual que el parcial) — mismo criterio ya aplicado antes en `20260701000000_sync_payroll_disbursement_and_schema/migration.sql`.

- **`ProductBarcode_code_idx`**: el diff propone un `DROP INDEX` + `CREATE INDEX` del mismo índice, con el mismo nombre y la misma definición (`USING btree (code text_pattern_ops)`, verificado en `pg_indexes` contra producción). Es una limitación conocida de Prisma con columnas de índice que usan un operador "crudo" (`@@index([code(ops: raw("text_pattern_ops"))])`): no logra confirmar por introspección que el índice ya existente coincide, así que siempre propone recrearlo.

Si una revisión futura de drift encuentra otras diferencias, no asumir que son de esta misma categoría — repetir la investigación (ver prompt-migraciones-rebaseline.md Fase 0) antes de descartarlas.
