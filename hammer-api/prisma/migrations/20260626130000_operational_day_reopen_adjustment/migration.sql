-- Nuevo estado para reapertura controlada de un día ya finalizado (ajuste Master),
-- sin volver a operación normal (no permite ventas nuevas, que exigen OPEN).
ALTER TYPE "OperationalDayStatus" ADD VALUE IF NOT EXISTS 'REOPENED_FOR_ADJUSTMENT';
