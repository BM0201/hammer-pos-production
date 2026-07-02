/**
 * Política de retención de datos de H.A.M.M.E.R. — fuente única de verdad.
 *
 * Clasificación (ver docs/POLITICA-RETENCION-DATOS.md para la justificación):
 *
 *  1. TRANSACCIONAL (libro del negocio): ventas, pagos, devoluciones, notas de
 *     crédito, movimientos de inventario, cajas, días operativos, compras,
 *     traslados, planilla. NUNCA se purga automáticamente. No aparece aquí.
 *
 *  2. ARCHIVO (auditoría y derivados con valor de registro): se conservan
 *     MÍNIMO 3 AÑOS (requisito del negocio) y luego se purgan por el sweep
 *     diario. Antes de purgarse pueden exportarse a CSV vía /api/reports/audit.
 *
 *  3. EFÍMERO (tokens y artefactos de seguridad): TTL corto propio
 *     (expiración explícita o ventana operativa). Se limpia en el mismo cron.
 */

/** Mínimo de retención definido por el negocio: 3 años. NO bajar de 1095. */
export const ARCHIVE_RETENTION_DAYS = 1095;

/**
 * Intentos de login: 90 días. Son telemetría de seguridad, no datos de negocio.
 * El rate-limiter usa una ventana de 15 minutos y el Security Center una de
 * 24 horas, así que 90 días cubre ambos usos con margen amplio para forense.
 */
export const LOGIN_ATTEMPT_RETENTION_DAYS = 90;

export function retentionCutoff(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
