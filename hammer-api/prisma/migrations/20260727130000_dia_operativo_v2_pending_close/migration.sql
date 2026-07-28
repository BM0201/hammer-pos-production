-- Día Operativo v2 Fase 5 — modelo "pendiente puro": un día que no se cierra
-- en su fecha sale de OPEN sin bloquear la sucursal ni perderse. Aditivo — el
-- enum no pierde ningún valor existente.

ALTER TYPE "OperationalDayStatus" ADD VALUE 'PENDING_CLOSE';
