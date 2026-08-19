/**
 * Barrel de compatibilidad — Día Operativo 360.
 *
 * El módulo `operations` se partió en piezas enfocadas (ver
 * dia-operativo-360-reescritura.md §4.1):
 *   business-date.ts   fecha de negocio / ventana operativa (puro)
 *   day-summary.ts     cálculo de snapshot, checklist informativo, reportes
 *   day-lifecycle.ts   todas las transiciones (barrido, confirmar, reabrir,
 *                      revertir, cancelar, abrir manual)
 *   day-resolver.ts    resolveOperationalDayForOperationTx — la única puerta
 *                      de entrada para caja/ventas; NUNCA lanza por estado
 *                      del día operativo.
 *
 * Este archivo solo re-exporta, para no forzar a actualizar cada import en
 * el resto del código. Los call sites que usaban nombres/formas viejas
 * (ensureOpenOperationalDayTx, closeOperationalDay, approveOperationalDayReview,
 * sweepDayToPendingCloseTx, listPendingCloseDays, etc. — el modelo de
 * "compuerta") sí se migraron a los nombres nuevos del modelo de "bitácora".
 */
export * from "@/modules/operations/business-date";
export * from "@/modules/operations/day-summary";
export * from "@/modules/operations/day-lifecycle";
export * from "@/modules/operations/day-resolver";
