import { Prisma, PrismaClient, BrainDecisionCategory, BrainDecisionSeverity } from "@prisma/client";
import { makeDecisionFingerprint, riskScoreFor, priorityScoreFor } from "@/modules/brain/scoring";

/**
 * PASO 2 (prompt-vigilancia-tesoreria-generalizacion.md) — no todas las
 * señales nacen dentro de una transacción de escritura (confirmBankDeposit,
 * la primera). cashExpensesExceedRetained se recalcula en cada GET de
 * getBranchExposureStatus — ahí no hay un `tx` más grande del que formar
 * parte, así que raiseCashDiscrepancy acepta también el singleton `prisma`
 * directo (un solo upsert es atómico de por sí, no necesita una
 * transacción propia).
 */
type DbClient = Prisma.TransactionClient | PrismaClient;

/**
 * prompt-vigilancia-tesoreria-generalizacion.md — la regla que
 * confirmBankDepositTx (treasury/service.ts) ya usaba a mano para el
 * depósito corto (REVIEW_BANK_DEPOSIT_SHORTFALL), generalizada a UN solo
 * lugar: la próxima vez que alguien encuentre una señal de descuadre en
 * tesorería, ESTA es la función obvia para dispararla — no un bloque de
 * ~30 líneas reinventado en cada módulo.
 *
 * Crea la BrainDecision DIRECTO por `tx`, en la MISMA transacción que
 * detecta el descuadre — no espera al próximo runBrainScan (que puede
 * tardar horas y ni siquiera escanea la mayoría de estas señales). Mismo
 * patrón ya establecido en cash-session/auto-close-service.ts y
 * sales/service.ts: escritura directa vía `tx.brainDecision`, sin pasar
 * por persistBrainDecisions (brain/service.ts) — esa función es la del
 * escaneo asíncrono y no acepta un `tx` inyectable (siempre usa el
 * singleton `prisma`), así que no sirve para escribir dentro de una
 * transacción ajena.
 *
 * Upsert por fingerprint SIEMPRE, nunca `create` simple:
 * - Para un hecho de una sola vez (fingerprint atado a un id recién
 *   creado en la misma transacción, ej. un BankDeposit) el upsert
 *   SIEMPRE toma la rama `create` — ese id no puede haber existido antes
 *   de esta transacción, así que no hay fila previa que actualizar. Cero
 *   diferencia de comportamiento contra un `create` simple.
 * - Para una señal recalculada en cada lectura (ej. un GET que arma un
 *   panel) con un fingerprint estable (branchId + alguna referencia que
 *   no cambia mientras la condición siga viva), el upsert evita crear una
 *   decisión duplicada cada vez que alguien abre la pantalla, y refresca
 *   los números (`evidenceJson`/`impactAmount`/scores) si cambiaron desde
 *   la última vez que se detectó.
 *
 * `status` vuelve a OPEN en cada upsert, aunque alguien ya la haya
 * descartado — mismo criterio que cash-session/auto-close-service.ts (el
 * otro lugar que ya escribe BrainDecision directo por tx): si la condición
 * sigue viva, se vuelve a mostrar. Deliberadamente NO se reimplementa acá
 * el dedupe más fino de persistBrainDecisions (respeta un DISMISSED
 * reciente, no molesta un SNOOZED sin vencer) — ese comportamiento vive en
 * el escaneo asíncrono; este archivo es para inyectar una decisión
 * inmediata desde dentro de una transacción, un caso más simple a
 * propósito.
 *
 * confidenceScore fijo en 0.95: cada llamador de este archivo describe un
 * hecho calculado directo del libro mayor (montos y cuentas exactos, no
 * una inferencia) — misma confianza alta que ya usaba
 * confirmBankDepositTx y que cash-detector.ts usa para REVIEW_CASH_SESSION
 * (riskScoreFor(severity, 98)).
 */
export type CashDiscrepancySignal = {
  category: BrainDecisionCategory;
  severity: BrainDecisionSeverity;
  title: string;
  description: string;
  recommendation: string;
  branchId: string | null;
  impactAmount: number;
  /** Distingue el tipo de hallazgo (REVIEW_BANK_DEPOSIT_SHORTFALL, REVIEW_BANK_DEPOSIT_MISMATCH, ...) — el frontend ya lo muestra tal cual (decision-card.tsx, InfoChip "Acción"). */
  proposedActionType: string;
  evidenceJson: Record<string, unknown>;
  sourceJson: Record<string, unknown>;
  /** Se pasa tal cual a makeDecisionFingerprint (brain/scoring.ts) — el llamador decide qué hace único (o estable) al hecho. */
  fingerprintParts: Array<string | number | boolean | null | undefined>;
};

const DISCREPANCY_CONFIDENCE_SCORE = 0.95;

export async function raiseCashDiscrepancy(tx: DbClient, signal: CashDiscrepancySignal) {
  const riskScore = riskScoreFor(signal.severity, DISCREPANCY_CONFIDENCE_SCORE);
  const priorityScore = priorityScoreFor({
    severity: signal.severity,
    riskScore,
    confidenceScore: DISCREPANCY_CONFIDENCE_SCORE,
    impactAmount: signal.impactAmount,
  });
  const fingerprint = makeDecisionFingerprint(signal.fingerprintParts);

  const fields = {
    category: signal.category,
    severity: signal.severity,
    title: signal.title,
    description: signal.description,
    recommendation: signal.recommendation,
    branchId: signal.branchId,
    confidenceScore: new Prisma.Decimal(DISCREPANCY_CONFIDENCE_SCORE),
    impactAmount: new Prisma.Decimal(signal.impactAmount),
    riskScore: new Prisma.Decimal(riskScore),
    priorityScore: new Prisma.Decimal(priorityScore),
    proposedActionType: signal.proposedActionType,
    evidenceJson: signal.evidenceJson as Prisma.InputJsonValue,
    sourceJson: signal.sourceJson as Prisma.InputJsonValue,
  };

  return tx.brainDecision.upsert({
    where: { fingerprint },
    create: { ...fields, fingerprint },
    update: { ...fields, status: "OPEN", lastDetectedAt: new Date() },
  });
}
