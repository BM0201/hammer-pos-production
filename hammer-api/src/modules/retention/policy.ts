/**
 * Política de retención de datos de H.A.M.M.E.R. — fuente única de verdad.
 *
 * Clasificación (ver docs/POLITICA-RETENCION-DATOS.md para la justificación):
 *
 *  1. TRANSACCIONAL (libro del negocio): ventas, pagos, devoluciones, notas de
 *     crédito, movimientos de inventario, cajas, días operativos, compras,
 *     traslados, planilla POSTEADA. NUNCA se purga automáticamente. No aparece aquí.
 *
 *  2. ARCHIVO (auditoría y derivados con valor de registro): se conservan
 *     MÍNIMO 3 AÑOS (requisito del negocio) y luego se purgan por el sweep
 *     diario. Antes de purgarse pueden exportarse a CSV vía /api/reports/audit.
 *
 *  3. EFÍMERO (tokens y artefactos de seguridad): TTL corto propio
 *     (expiración explícita o ventana operativa). Se limpia en el mismo cron.
 *
 *  4. OBSOLETO OPERATIVO (basura que el flujo dejó atrás y ya no ejecuta nada):
 *     borradores de nómina abandonados, préstamos cancelados sin historial de
 *     deducción, gastos automáticos desactivados. Ventanas cortas por regla —
 *     el sweep diario los recoge en cuanto vencen, así el sistema queda limpio
 *     mes a mes sin intervención manual. Un registro ABIERTO o con historial
 *     financiero real jamás se purga por esta vía.
 */

/** Mínimo de retención definido por el negocio: 3 años. NO bajar de 1095. */
export const ARCHIVE_RETENTION_DAYS = 1095;

/**
 * Borradores de nómina (PayrollRun DRAFT) sin actividad: 45 días. Un borrador
 * de un mes pasado que nunca se posteó es basura — el que sí importa (el del
 * mes en curso) se recalcula constantemente y su updatedAt lo mantiene vivo.
 */
export const STALE_PAYROLL_DRAFT_RETENTION_DAYS = 45;

/**
 * Préstamos CANCELADOS: 90 días desde su última actualización. Solo se purgan
 * los que NUNCA tuvieron deducción/abono real (esos conservan historial).
 */
export const CANCELLED_LOAN_RETENTION_DAYS = 90;

/**
 * Gastos operativos AUTO-calculados y desactivados (p. ej. los duplicados por
 * quincena que la unificación del costo laboral apagó): 180 días. Solo si no
 * están ligados a un movimiento de caja (esa liga clasifica gastos históricos).
 */
export const INACTIVE_AUTO_EXPENSE_RETENTION_DAYS = 180;

/**
 * Intentos de login: 90 días. Son telemetría de seguridad, no datos de negocio.
 * El rate-limiter usa una ventana de 15 minutos y el Security Center una de
 * 24 horas, así que 90 días cubre ambos usos con margen amplio para forense.
 */
export const LOGIN_ATTEMPT_RETENTION_DAYS = 90;

export function retentionCutoff(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
