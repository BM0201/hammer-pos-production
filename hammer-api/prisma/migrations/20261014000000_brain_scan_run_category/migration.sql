-- prompt-completo-pendientes-2026-10.md Parte A 1.4 — day-summary.ts
-- preguntaba "¿corrió un BrainScanRun hoy?" solo con status != RUNNING,
-- sin distinguir una corrida COMPLETA (el cron de cada hora, o "Escanear
-- ahora") de una acotada a una sola categoría ("Recalcular ahora" de
-- Precios manda mode:SCHEDULED_SCAN + category:"PRICING" — ve un solo
-- detector). NULL = completa; filas existentes quedan NULL (completas),
-- que es lo correcto para todo lo ya corrido antes de esta migración.
ALTER TABLE "BrainScanRun" ADD COLUMN "category" "BrainDecisionCategory";
