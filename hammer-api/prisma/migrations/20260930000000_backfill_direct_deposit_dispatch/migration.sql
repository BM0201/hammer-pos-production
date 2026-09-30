-- prompt-tesoreria-custodia-sucursal.md Fase 1.4 — liga los DEPOSIT_DISPATCH
-- legacy del depósito directo (creados antes de 1.2) a su BankDeposit real,
-- para que getLastDepositCutoff (1.3) los atribuya a la sucursal correcta en
-- vez de a la sucursal de la custodia (que con una persona multi-sucursal
-- puede ser otra).
--
-- Verificado en modo conteo contra la base real (2026-09-30) ANTES de
-- escribir este UPDATE: 6 entradas legacy, las 6 con EXACTAMENTE un
-- BankDeposit candidato (0 sin match, 0 ambiguas). El WHERE de abajo igual
-- exige el candidato único en el momento de aplicar — si la base cambió
-- entre el conteo y la aplicación, una fila que dejó de tener un único
-- candidato simplemente no se actualiza, no se aplica a ciegas.
--
-- Idempotente: bankDepositId IS NULL en el WHERE evita volver a tocar una
-- fila ya vinculada en una corrida anterior.
UPDATE "TreasuryEntry" te
SET "bankDepositId" = bd.id
FROM "BankDeposit" bd
WHERE te."entryType" = 'DEPOSIT_DISPATCH'
  AND te."bankDepositId" IS NULL
  AND te."cashMovementId" IS NULL
  AND te.notes = 'Depósito directo desde efectivo retenido de sucursal'
  AND bd."confirmedByUserId" = te."createdByUserId"
  AND bd."createdAt" BETWEEN te."createdAt" - INTERVAL '5 seconds' AND te."createdAt" + INTERVAL '5 seconds'
  AND (
    SELECT COUNT(*)
    FROM "BankDeposit" bd2
    WHERE bd2."confirmedByUserId" = te."createdByUserId"
      AND bd2."createdAt" BETWEEN te."createdAt" - INTERVAL '5 seconds' AND te."createdAt" + INTERVAL '5 seconds'
  ) = 1;
