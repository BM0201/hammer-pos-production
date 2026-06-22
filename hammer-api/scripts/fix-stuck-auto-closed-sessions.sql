-- ============================================================================
-- Remediación: sesiones de caja atascadas en AUTO_CLOSED_PENDING_REVIEW
-- ============================================================================
--
-- CONTEXTO
-- La "Limpieza Forzada" (acción resolveAutoClosedPendingReview) tenía un bug:
-- ponía requiresReview=false y countedCashAmount=expected, pero NUNCA avanzaba
-- el status. La sesión quedaba en AUTO_CLOSED_PENDING_REVIEW para siempre:
--   - El Centro de Comando clasifica por STATUS → seguía en "Pendiente de revisión".
--   - El botón "OK" exige requiresReview=true → ya no podía limpiarla (409).
--
-- Estas filas "medio-resueltas" se identifican por:
--   status = 'AUTO_CLOSED_PENDING_REVIEW' AND requiresReview = false
--
-- Este script las finaliza a AUTO_CLOSED, dejándolas consistentes con el flujo
-- corregido. Es idempotente y seguro de re-ejecutar.
--
-- USO (Postgres):
--   psql "$DATABASE_URL" -f scripts/fix-stuck-auto-closed-sessions.sql
--
-- Después de aplicar el fix de código, también puedes simplemente volver a correr
-- "Limpieza Forzada → Resolver sesiones auto-cerradas pendientes" desde la UI; la
-- query ahora también captura estas filas. Este script es la alternativa directa.
-- ============================================================================

-- 1) Inspección previa (revisa qué filas se van a tocar antes de actualizar).
SELECT
  cs.id,
  cs.status,
  cs."requiresReview",
  cs."expectedCashAmount",
  cs."countedCashAmount",
  cs."differenceAmount",
  pcb.code AS box_code,
  b.code   AS branch_code
FROM "CashSession" cs
JOIN "PhysicalCashBox" pcb ON pcb.id = cs."physicalCashBoxId"
JOIN "Branch" b           ON b.id  = pcb."branchId"
WHERE cs.status = 'AUTO_CLOSED_PENDING_REVIEW'
  AND cs."requiresReview" = false;

-- 2) Finalización: avanza el status y completa los campos de revisión.
UPDATE "CashSession"
SET
  status              = 'AUTO_CLOSED',
  "countedCashAmount" = COALESCE("countedCashAmount", "expectedCashAmount", 0),
  "closingAmount"     = COALESCE("closingAmount", "countedCashAmount", "expectedCashAmount", 0),
  "differenceAmount"  = COALESCE("differenceAmount", 0),
  "closedAt"          = COALESCE("closedAt", "autoClosedAt", NOW()),
  "reviewedAt"        = COALESCE("reviewedAt", NOW()),
  "reviewNote"        = COALESCE("reviewNote", 'Remediación: cierre forzado finalizado (status corregido).')
WHERE status = 'AUTO_CLOSED_PENDING_REVIEW'
  AND "requiresReview" = false;

-- 3) Verificación posterior: no deberían quedar filas medio-resueltas.
SELECT COUNT(*) AS remaining_half_resolved
FROM "CashSession"
WHERE status = 'AUTO_CLOSED_PENDING_REVIEW'
  AND "requiresReview" = false;
