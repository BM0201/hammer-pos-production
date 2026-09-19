-- Fase 2 de prompt-flujo-velocidad.md: índices para búsqueda de catálogo,
-- saldo de tesorería y gastos. Todo con IF NOT EXISTS / IF EXISTS porque al
-- verificar contra la DB real (solo lectura) se encontró que
-- "Product_isActive_name_idx" y el GIN de pg_trgm de Product.name YA
-- existían ahí (creados por fuera del historial de migraciones, no se
-- investigó por quién) — esta migración debe poder aplicarse tanto sobre
-- esa DB con drift como sobre una DB limpia sin fallar por "ya existe".
--
-- Medido en la DB real (solo lectura, EXPLAIN ANALYZE, catálogo de 1133
-- productos): con el planner libre, un ILIKE '%termino%' sobre Product.name
-- elige Seq Scan (0.39ms) y NO el índice GIN — a este tamaño de tabla, un
-- seq scan ya es más barato que el índice. Forzando el uso del índice
-- (enable_seqscan=off) el plan sí usa "Product_name_trgm_idx"
-- correctamente (Bitmap Index Scan) pero tarda MÁS (3.3ms) que el seq scan.
-- El índice es válido y funciona — es una inversión para cuando el catálogo
-- crezca, no una mejora medible hoy. Ninguna de las dos rutas cambia el
-- resultado de la búsqueda, solo el plan.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateIndex (Product)
CREATE INDEX IF NOT EXISTS "Product_isActive_name_idx" ON "Product"("isActive", "name");
CREATE INDEX IF NOT EXISTS "Product_categoryId_idx" ON "Product"("categoryId");
-- NOTA: en la DB donde se verificó este trabajo (solo lectura), ya existe un
-- índice GIN equivalente sobre Product.name con OTRO nombre
-- ("Product_name_trgm_idx", fuera del historial de migraciones). IF NOT
-- EXISTS no lo detecta por tener nombre distinto — si esta migración se
-- aplica ahí, va a crear un GIN duplicado bajo "Product_name_idx". Antes de
-- aplicar en esa DB puntual, DROP INDEX "Product_name_trgm_idx" o renombrarlo
-- a "Product_name_idx" para no duplicar.
CREATE INDEX IF NOT EXISTS "Product_name_idx" ON "Product" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_sku_idx" ON "Product" USING GIN ("sku" gin_trgm_ops);

-- CreateIndex (TreasuryEntry) — saldo por cuenta filtrado por dirección
-- (IN/OUT) además del compuesto existente accountId+occurredAt+createdAt.
CREATE INDEX IF NOT EXISTS "TreasuryEntry_accountId_direction_idx" ON "TreasuryEntry"("accountId", "direction");

-- CreateIndex (CashMovement) — reemplaza el índice de solo `type`.
CREATE INDEX IF NOT EXISTS "CashMovement_type_createdAt_idx" ON "CashMovement"("type", "createdAt");
DROP INDEX IF EXISTS "CashMovement_type_idx";

-- CreateIndex (AuditLog) — bitácora filtrada por sucursal + rango de fecha.
CREATE INDEX IF NOT EXISTS "AuditLog_branchId_occurredAt_idx" ON "AuditLog"("branchId", "occurredAt");

-- DropIndex (CsrfToken) — duplicado exacto: token ya es @unique, que crea
-- su propio índice (CsrfToken_token_key).
DROP INDEX IF EXISTS "CsrfToken_token_idx";
