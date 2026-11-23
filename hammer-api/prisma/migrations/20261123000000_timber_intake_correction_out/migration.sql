-- Corregir un viaje de madera ingresado: las piezas que se quitan salen con su propio tipo
-- (resta del ingreso de madera), no como ADJUSTMENT_OUT, que el reporte cuenta como ajuste/conteo.
-- 100% aditivo. Va sola: Postgres no deja usar un valor de enum nuevo en la misma transacción.
ALTER TYPE "InventoryMovementType" ADD VALUE 'TIMBER_INTAKE_CORRECTION_OUT';
