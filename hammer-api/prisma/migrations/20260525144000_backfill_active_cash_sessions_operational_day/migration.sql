WITH active_sessions AS (
  SELECT
    cs.id AS "cashSessionId",
    pcb."branchId",
    cs."openedByUserId",
    cs."openedAt",
    date_trunc('day', cs."openedAt" AT TIME ZONE 'America/Managua')::timestamp AS "businessDate"
  FROM "CashSession" cs
  JOIN "PhysicalCashBox" pcb ON pcb.id = cs."physicalCashBoxId"
  WHERE cs."operationalDayId" IS NULL
    AND cs.status IN ('OPEN', 'RECONCILING', 'AUTO_CLOSED_PENDING_REVIEW')
),
days AS (
  SELECT
    'opday_' || md5("branchId" || ':' || "businessDate"::text) AS id,
    "branchId",
    "businessDate",
    (array_agg("openedByUserId" ORDER BY "openedAt" ASC))[1] AS "openedByUserId",
    min("openedAt") AS "openedAt"
  FROM active_sessions
  GROUP BY "branchId", "businessDate"
)
INSERT INTO "OperationalDay" (
  id,
  "branchId",
  "businessDate",
  status,
  "openedByUserId",
  "openedAt",
  "createdAt",
  "updatedAt",
  notes
)
SELECT
  id,
  "branchId",
  "businessDate",
  'OPEN',
  "openedByUserId",
  "openedAt",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  'Backfill automatico para sesiones de caja activas existentes.'
FROM days
ON CONFLICT ("branchId", "businessDate") DO NOTHING;

WITH active_sessions AS (
  SELECT
    cs.id AS "cashSessionId",
    pcb."branchId",
    date_trunc('day', cs."openedAt" AT TIME ZONE 'America/Managua')::timestamp AS "businessDate"
  FROM "CashSession" cs
  JOIN "PhysicalCashBox" pcb ON pcb.id = cs."physicalCashBoxId"
  WHERE cs."operationalDayId" IS NULL
    AND cs.status IN ('OPEN', 'RECONCILING', 'AUTO_CLOSED_PENDING_REVIEW')
)
UPDATE "CashSession" cs
SET "operationalDayId" = od.id
FROM active_sessions a
JOIN "OperationalDay" od
  ON od."branchId" = a."branchId"
 AND od."businessDate" = a."businessDate"
WHERE cs.id = a."cashSessionId"
  AND cs."operationalDayId" IS NULL;
