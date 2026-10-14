-- Fase 1 (prompt-entrada-inventario.md) — un solo documento de entrada
-- (sumar, contar o cargar), idempotente, con tandas reanudables.

-- "Ampliar kind: ADD_STOCK | PHYSICAL_COUNT | OPENING_BALANCE. Mantener
-- ADJUSTMENT_IN como alias de ADD_STOCK para compatibilidad" — el valor
-- viejo NO se borra (hay filas reales con él); el código nuevo trata
-- ADJUSTMENT_IN igual que ADD_STOCK, y las entradas nuevas ya escriben
-- ADD_STOCK directamente.
ALTER TYPE "MultiBranchIntakeKind" ADD VALUE 'ADD_STOCK';
ALTER TYPE "MultiBranchIntakeKind" ADD VALUE 'PHYSICAL_COUNT';

-- Progreso por sucursal, para poder reanudar una tanda que falló a la
-- mitad sin reprocesar lo que ya se guardó.
ALTER TYPE "MultiBranchIntakeBranchStatus" ADD VALUE 'IN_PROGRESS';

ALTER TABLE "MultiBranchIntakeBranch" ADD COLUMN "processedLines" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MultiBranchIntakeBranch" ADD COLUMN "totalLines" INTEGER NOT NULL DEFAULT 0;

-- Antes no se guardaba: retry/continue reprocesaban siempre con notes=null.
ALTER TABLE "MultiBranchIntake" ADD COLUMN "notes" TEXT;
