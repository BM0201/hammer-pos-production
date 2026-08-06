-- Agrega frecuencia de cuota a los préstamos de empleados.
-- MONTHLY (por defecto): la cuota se descuenta una vez al mes.
-- BIWEEKLY: la cuota se descuenta en cada quincena (2 veces al mes).
ALTER TABLE "EmployeeLoan" ADD COLUMN "installmentFrequency" TEXT NOT NULL DEFAULT 'MONTHLY';
