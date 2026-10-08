-- prompt-brain-centro-decisiones.md Fase 1.1 — nuevo valor de enum SOLO,
-- en su propia migración/transacción: Postgres no deja usar un valor de
-- enum recién agregado dentro de la MISMA transacción que lo agrega. La
-- migración siguiente (brain_scan_run_and_decision_fields) ya puede usarlo
-- porque corre en su propia transacción, después de que esta haya
-- confirmado. Aditiva: no toca ninguna fila existente.

ALTER TYPE "BrainDecisionStatus" ADD VALUE 'RESOLVED';
