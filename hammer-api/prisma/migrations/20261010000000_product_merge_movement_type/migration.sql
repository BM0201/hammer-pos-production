-- prompt-codigos-y-duplicados.md Fase 3 — unificar productos duplicados.
-- Solo agrega los 2 valores nuevos al enum InventoryMovementType, sola en
-- su propia migración: Postgres no deja usar un valor de enum recién
-- agregado en la MISMA transacción que lo agrega (mismo precedente que
-- 20261008000000_brain_decision_status_resolved — BrainDecisionStatus.RESOLVED).

ALTER TYPE "InventoryMovementType" ADD VALUE 'PRODUCT_MERGE_OUT';
ALTER TYPE "InventoryMovementType" ADD VALUE 'PRODUCT_MERGE_IN';
