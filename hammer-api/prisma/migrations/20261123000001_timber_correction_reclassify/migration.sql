-- Las correcciones de viaje hechas antes del tipo nuevo salieron como ADJUSTMENT_OUT (VJM-2026-001:
-- 3 filas el 2026-11-23). Solo se cambia la etiqueta: cantidad, costo, saldo y WAC quedan igual,
-- porque los dos tipos son salidas. Ningún otro flujo crea ADJUSTMENT_OUT con referencia TIMBER_TRIP.
UPDATE "InventoryMovement"
SET "movementType" = 'TIMBER_INTAKE_CORRECTION_OUT'
WHERE "movementType" = 'ADJUSTMENT_OUT' AND "referenceType" = 'TIMBER_TRIP';
