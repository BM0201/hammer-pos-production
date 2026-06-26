-- Operational Day como fuente de verdad: operationalDayId en ventas/pagos/etc.
-- + campos offline. Additivo (columnas nullable + índices) y con backfill best-effort
-- por la ventana operativa (businessDate 06:00 UTC, +24h) que ya usa el módulo.
-- Idempotente: IF NOT EXISTS en columnas/índices y FKs envueltos en DO/EXCEPTION.

-- ─── Columnas ────────────────────────────────────────────────────────────────
ALTER TABLE "SaleOrder"
  ADD COLUMN IF NOT EXISTS "operationalDayId" TEXT,
  ADD COLUMN IF NOT EXISTS "saleOccurredAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "postedAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "syncedAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "offlineClientId"  TEXT;

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "operationalDayId" TEXT,
  ADD COLUMN IF NOT EXISTS "postedAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "syncedAt"         TIMESTAMP(3);

ALTER TABLE "PaymentTender"    ADD COLUMN IF NOT EXISTS "operationalDayId" TEXT;
ALTER TABLE "DispatchTicket"   ADD COLUMN IF NOT EXISTS "operationalDayId" TEXT;
ALTER TABLE "TransportService" ADD COLUMN IF NOT EXISTS "operationalDayId" TEXT;
ALTER TABLE "Refund"           ADD COLUMN IF NOT EXISTS "operationalDayId" TEXT;

-- ─── Backfill (best-effort por ventana operativa) ────────────────────────────
-- Ventana: [businessDate + 6h, businessDate + 30h)  (= 06:00 a 06:00 del día siguiente)

UPDATE "SaleOrder" so
SET "operationalDayId" = od.id
FROM "OperationalDay" od
WHERE so."operationalDayId" IS NULL
  AND od."branchId" = so."branchId"
  AND so."createdAt" >= od."businessDate" + interval '6 hours'
  AND so."createdAt" <  od."businessDate" + interval '30 hours';

UPDATE "SaleOrder" SET "saleOccurredAt" = "createdAt" WHERE "saleOccurredAt" IS NULL;
UPDATE "SaleOrder" SET "postedAt"       = "createdAt" WHERE "postedAt" IS NULL;

UPDATE "Payment" p
SET "operationalDayId" = od.id
FROM "OperationalDay" od, "SaleOrder" so
WHERE p."operationalDayId" IS NULL
  AND so.id = p."saleOrderId"
  AND od."branchId" = so."branchId"
  AND p."paidAt" >= od."businessDate" + interval '6 hours'
  AND p."paidAt" <  od."businessDate" + interval '30 hours';

UPDATE "Payment" SET "postedAt" = "paidAt" WHERE "postedAt" IS NULL;

UPDATE "PaymentTender" pt
SET "operationalDayId" = p."operationalDayId"
FROM "Payment" p
WHERE pt."paymentId" = p.id
  AND pt."operationalDayId" IS NULL
  AND p."operationalDayId" IS NOT NULL;

UPDATE "DispatchTicket" d
SET "operationalDayId" = od.id
FROM "OperationalDay" od
WHERE d."operationalDayId" IS NULL
  AND od."branchId" = d."branchId"
  AND d."createdAt" >= od."businessDate" + interval '6 hours'
  AND d."createdAt" <  od."businessDate" + interval '30 hours';

UPDATE "TransportService" t
SET "operationalDayId" = od.id
FROM "OperationalDay" od
WHERE t."operationalDayId" IS NULL
  AND od."branchId" = t."branchId"
  AND t."createdAt" >= od."businessDate" + interval '6 hours'
  AND t."createdAt" <  od."businessDate" + interval '30 hours';

UPDATE "Refund" r
SET "operationalDayId" = cs."operationalDayId"
FROM "CashSession" cs
WHERE r."cashSessionId" = cs.id
  AND r."operationalDayId" IS NULL
  AND cs."operationalDayId" IS NOT NULL;

-- Backfill offlineClientId desde el tag legacy "[OFFLINE:<id>]" en notes, SOLO cuando
-- ese id aparece exactamente una vez (evita colisión con el índice único nuevo).
UPDATE "SaleOrder" so
SET "offlineClientId" = m.oid
FROM (
  SELECT (regexp_match(notes, '\[OFFLINE:([^\]]+)\]'))[1] AS oid, MIN(id) AS keep_id, COUNT(*) AS c
  FROM "SaleOrder"
  WHERE notes LIKE '[OFFLINE:%'
  GROUP BY 1
) m
WHERE m.c = 1
  AND so.id = m.keep_id
  AND so."offlineClientId" IS NULL;

-- ─── Índices ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "SaleOrder_offlineClientId_key" ON "SaleOrder"("offlineClientId");
CREATE INDEX IF NOT EXISTS "SaleOrder_operationalDayId_idx" ON "SaleOrder"("operationalDayId");
CREATE INDEX IF NOT EXISTS "SaleOrder_branchId_operationalDayId_status_idx" ON "SaleOrder"("branchId", "operationalDayId", "status");

CREATE INDEX IF NOT EXISTS "Payment_operationalDayId_idx" ON "Payment"("operationalDayId");
CREATE INDEX IF NOT EXISTS "Payment_cashSessionId_operationalDayId_idx" ON "Payment"("cashSessionId", "operationalDayId");

CREATE INDEX IF NOT EXISTS "PaymentTender_operationalDayId_method_idx" ON "PaymentTender"("operationalDayId", "method");
CREATE INDEX IF NOT EXISTS "DispatchTicket_operationalDayId_idx" ON "DispatchTicket"("operationalDayId");
CREATE INDEX IF NOT EXISTS "TransportService_operationalDayId_idx" ON "TransportService"("operationalDayId");
CREATE INDEX IF NOT EXISTS "Refund_operationalDayId_idx" ON "Refund"("operationalDayId");

-- ─── Foreign keys (idempotentes) ─────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "SaleOrder" ADD CONSTRAINT "SaleOrder_operationalDayId_fkey"
    FOREIGN KEY ("operationalDayId") REFERENCES "OperationalDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Payment" ADD CONSTRAINT "Payment_operationalDayId_fkey"
    FOREIGN KEY ("operationalDayId") REFERENCES "OperationalDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PaymentTender" ADD CONSTRAINT "PaymentTender_operationalDayId_fkey"
    FOREIGN KEY ("operationalDayId") REFERENCES "OperationalDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DispatchTicket" ADD CONSTRAINT "DispatchTicket_operationalDayId_fkey"
    FOREIGN KEY ("operationalDayId") REFERENCES "OperationalDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TransportService" ADD CONSTRAINT "TransportService_operationalDayId_fkey"
    FOREIGN KEY ("operationalDayId") REFERENCES "OperationalDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Refund" ADD CONSTRAINT "Refund_operationalDayId_fkey"
    FOREIGN KEY ("operationalDayId") REFERENCES "OperationalDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
