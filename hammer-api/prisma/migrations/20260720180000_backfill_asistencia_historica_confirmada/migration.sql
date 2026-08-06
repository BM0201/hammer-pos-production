-- Backfill: los pases de asistencia tomados ANTES de que existiera la
-- confirmación de Master (migración 20260720170000) quedaron en "PENDING"
-- por el DEFAULT de la columna nueva, pero no tienen ninguna fila en
-- AttendanceMark (esa tabla no existía cuando se tomaron) — no hay nada que
-- Master pueda revisar ahí. Se marcan como CONFIRMED (ya sucedieron, sin
-- revisor) para que no queden colgados en la cola de pendientes sin datos.

UPDATE "AttendanceRollCall" rc
SET
  "reviewStatus" = 'CONFIRMED',
  "reviewedAt" = rc."createdAt"
WHERE rc."reviewStatus" = 'PENDING'
  AND NOT EXISTS (
    SELECT 1 FROM "AttendanceMark" am WHERE am."rollCallId" = rc."id"
  );
