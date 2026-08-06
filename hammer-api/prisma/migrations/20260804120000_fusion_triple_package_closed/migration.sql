-- Fusión triple: permite reempacar sueltas de vuelta a empaque cerrado
-- (reverso de PACKAGE_OPENED) — closeStockPackage en inventory/service.ts.
-- Aditivo — el enum no pierde ningún valor existente.

ALTER TYPE "InventoryMovementType" ADD VALUE 'PACKAGE_CLOSED';
