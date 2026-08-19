-- Backfill: decisiones de Brain "Dia operativo cerrado con advertencias"
-- (fingerprint operations:closed-with-warnings:<operationalDayId>) que NUNCA
-- se marcaban resueltas al aprobar el día — quedaban OPEN para siempre salvo
-- el barrido pasivo de 7 días. Cualquier día YA APROBADO (approvedAt no nulo)
-- ya fue revisado y aceptado por Master, así que su advertencia se cierra
-- retroactivamente (EXECUTED) en vez de seguir apareciendo como pendiente.
--
-- No toca decisiones ya DISMISSED (Master las descartó explícitamente) ni las
-- de "approve-exception" (esas sí quedan como registro permanente de auditoría).

UPDATE "BrainDecision" bd
SET
  "status" = 'EXECUTED',
  "resolvedAt" = od."approvedAt",
  "resolvedByUserId" = od."approvedByMasterId"
FROM "OperationalDay" od
WHERE bd."fingerprint" = 'operations:closed-with-warnings:' || od."id"
  AND od."approvedAt" IS NOT NULL
  AND bd."status" NOT IN ('EXECUTED', 'DISMISSED');
