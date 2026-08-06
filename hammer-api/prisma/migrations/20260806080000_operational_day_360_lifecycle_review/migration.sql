-- Día Operativo 360: el día deja de ser una COMPUERTA (bloquea caja/venta
-- según su estado) y pasa a ser una BITÁCORA (queda en espera indefinida
-- hasta que Master la confirma a mano — igual que AttendanceRollCall).
--
-- El enum único OperationalDayStatus se reemplaza por dos ejes ortogonales:
--   lifecycle    (dueño: el sistema, automático) ACTIVE | AWAITING_REVIEW | CANCELLED
--   reviewStatus (dueño: Master, manual)         PENDING | CONFIRMED
-- reviewStatus = CONFIRMED solo lo escribe un humano real — ningún cron.
-- Ver dia-operativo-360-reescritura.md.

-- CreateEnum
CREATE TYPE "OperationalDayLifecycle" AS ENUM ('ACTIVE', 'AWAITING_REVIEW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OperationalDayReviewStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- AlterTable: columnas nuevas de ambos ejes + firma humana + snapshot renombrado.
ALTER TABLE "OperationalDay"
  ADD COLUMN "lifecycle"         "OperationalDayLifecycle"    NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "reviewStatus"      "OperationalDayReviewStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "sweptAt"           TIMESTAMP(3),
  ADD COLUMN "sweptBySystem"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sweptByUserId"     TEXT,
  ADD COLUMN "reviewedByUserId"  TEXT,
  ADD COLUMN "reviewedAt"        TIMESTAMP(3),
  ADD COLUMN "reviewNote"        TEXT,
  ADD COLUMN "checklistJson"     JSONB,
  ADD COLUMN "reviewSummaryJson" JSONB;

-- Backfill eje lifecycle, derivado del status viejo.
UPDATE "OperationalDay" SET "lifecycle" =
  (CASE "status"::text
    WHEN 'OPEN'                     THEN 'ACTIVE'
    WHEN 'REOPENED_FOR_ADJUSTMENT'  THEN 'ACTIVE'
    WHEN 'CLOSING'                  THEN 'AWAITING_REVIEW'
    WHEN 'PENDING_CLOSE'            THEN 'AWAITING_REVIEW'
    WHEN 'CLOSED'                   THEN 'AWAITING_REVIEW'
    WHEN 'CANCELLED'                THEN 'CANCELLED'
    ELSE 'AWAITING_REVIEW'
  END)::"OperationalDayLifecycle";

-- Backfill eje humano. CRÍTICO: solo un día con firma REAL de Master pasa a
-- CONFIRMED. Un día cerrado por el cron viejo (approvedByMasterId nulo)
-- vuelve a la cola de pendientes — es el comportamiento deseado: si nadie lo
-- firmó, espera.
UPDATE "OperationalDay" SET
  "reviewStatus"      = 'CONFIRMED',
  "reviewedByUserId"  = "approvedByMasterId",
  "reviewedAt"        = "approvedAt",
  "reviewSummaryJson" = "approvalSummaryJson"
WHERE "approvedByMasterId" IS NOT NULL;

UPDATE "OperationalDay" SET
  "sweptAt"       = "closedAt",
  "sweptByUserId" = "closedByUserId",
  "sweptBySystem" = ("closedByUserId" IS NULL)
WHERE "closedAt" IS NOT NULL;

UPDATE "OperationalDay" SET "checklistJson" = "closeChecklistJson"
WHERE "closeChecklistJson" IS NOT NULL;

-- AlterTable: recién ahora, drop de lo viejo (después del backfill).
ALTER TABLE "OperationalDay"
  DROP COLUMN "status",
  DROP COLUMN "closedByUserId",
  DROP COLUMN "approvedByMasterId",
  DROP COLUMN "closedAt",
  DROP COLUMN "approvedAt",
  DROP COLUMN "closeChecklistJson",
  DROP COLUMN "closeSummaryJson",
  DROP COLUMN "approvalSummaryJson";

-- DropEnum
DROP TYPE "OperationalDayStatus";

-- CreateIndex
CREATE INDEX "OperationalDay_branchId_lifecycle_idx" ON "OperationalDay"("branchId", "lifecycle");

-- CreateIndex
CREATE INDEX "OperationalDay_reviewStatus_businessDate_idx" ON "OperationalDay"("reviewStatus", "businessDate");

-- AddForeignKey
ALTER TABLE "OperationalDay"
  ADD CONSTRAINT "OperationalDay_sweptByUserId_fkey"
  FOREIGN KEY ("sweptByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalDay"
  ADD CONSTRAINT "OperationalDay_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
