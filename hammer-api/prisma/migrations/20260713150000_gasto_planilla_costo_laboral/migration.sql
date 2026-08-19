-- Unificación del gasto de planilla en el libro de Gastos operativos.
-- El ÚNICO gasto de planilla es el costo laboral mensual por empleado
-- (employerCost, creado al postear la corrida). Los gastos automáticos que el
-- pago de cada quincena creaba al NETO duplicaban la planilla en el libro:
-- se desactivan (no se borran: quedan como histórico auditable).
--
-- Esta migración es de DATOS (no cambia el schema).

UPDATE "OperatingExpense"
SET "isActive" = false
WHERE "isAutoCalculated" = true
  AND "category" = 'PAYROLL'
  AND ("description" LIKE 'Nómina (1ra quincena):%' OR "description" LIKE 'Nómina (2da quincena):%');
