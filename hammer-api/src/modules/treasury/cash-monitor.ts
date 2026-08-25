import { CashMovementType, CashSessionStatus, PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { syncCashSessionSnapshotTx, userCanOperateCashSessionTx, calculateExpectedCashForSessionTx } from "@/modules/cash-session/service";
import { mean, stddev } from "@/modules/ai-insights/analyzer";
import { createTreasuryEntryTx, findOrCreateCustodyAccountTx, getActiveRetainedCashExpenses } from "@/modules/treasury/service";
import { nextBusinessDayFrom } from "@/modules/operations/business-date";

/**
 * prompt-indicador-efectivo-inteligente.md — indicador de efectivo en la
 * barra lateral: cuánto hay, cuánto viene acumulado, cuándo toca depositar,
 * y a qué cuenta está entrando el dinero. "Inteligente" acá significa
 * proyectar desde datos que el sistema ya tiene y mostrar SIEMPRE sobre qué
 * se calculó — nunca un número con aire de certeza que nadie puede
 * verificar (§1).
 */

const MS_PER_DAY = 86_400_000;
const WEEKDAY_LABELS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ── §2.1 · Para depositar — pura, sin DB ────────────────────────────── */

/**
 * "Para depositar" tiene que incluir SIEMPRE los tres términos: lo que hay
 * hoy en la sesión abierta MÁS lo acumulado de declaraciones previas, menos
 * el fondo de caja (prompt-correccion-ubicacion-formula-datos-prueba.md
 * C2/§2.2). Extraída como función propia y con nombre — antes vivía inline
 * dentro de getBranchCashPosition, donde un futuro cambio en el orden de
 * los términos no tenía ningún test que lo pescara.
 *
 * cashFloor null = sin configurar: se muestra el total completo, nunca se
 * inventa un descuento (floorConfigured en false dispara la nota "sin fondo
 * configurado" en la interfaz).
 */
export function computeAmountToDeposit(input: {
  cashInDrawerToday: number;
  accumulatedAmount: number;
  cashFloor: number | null;
}): { amount: number; floorConfigured: boolean } {
  const total = round2(input.cashInDrawerToday + input.accumulatedAmount);
  if (input.cashFloor === null) {
    return { amount: total, floorConfigured: false };
  }
  return { amount: Math.max(0, round2(total - input.cashFloor)), floorConfigured: true };
}

/* ── §2.2 · La proyección — pura, sin DB ─────────────────────────────── */

export type ThresholdProjection = {
  earliestDate: Date | null;
  likelyDate: Date | null;
  basis: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
};

function walkToThreshold(remaining: number, ratesByWeekday: Record<number, number>, from: Date): Date | null {
  let accumulated = 0;
  let cursor = new Date(from.getTime());
  let days = 0;
  // Tope de 60 días: si el ritmo diario es 0 o insuficiente, sin esto sería
  // un loop infinito — y 60 días sin alcanzar el umbral ya no es una
  // proyección útil, es "no se sabe".
  while (accumulated < remaining && days < 60) {
    cursor = new Date(cursor.getTime() + MS_PER_DAY);
    accumulated += Math.max(0, ratesByWeekday[cursor.getUTCDay()] ?? 0);
    days++;
  }
  return accumulated >= remaining ? cursor : null;
}

/**
 * Usa el promedio de cobro en efectivo POR DÍA DE SEMANA de las últimas N
 * semanas, no un promedio plano (§2.2): en materiales de construcción un
 * sábado no se parece a un martes.
 *
 * Devuelve un RANGO: `likelyDate` camina con el promedio; `earliestDate`
 * camina con promedio + desvío (el caso optimista). Sin desvío disponible
 * por día de semana, el rango colapsa a un punto — comportamiento honesto,
 * no se inventa variabilidad que no se midió.
 */
export function projectThresholdReach(input: {
  currentAmount: number;
  thresholdAmount: number;
  dailyCashByWeekday: Record<number, number>;
  dailyCashStddevByWeekday?: Record<number, number>;
  weeksOfHistory: number;
  now?: Date;
}): ThresholdProjection {
  const basis = `promedio de las últimas ${input.weeksOfHistory} semana${input.weeksOfHistory === 1 ? "" : "s"}`;

  // Confianza LOW con poca historia → sin proyección (§2.2: "es mejor no
  // decir nada que decir algo que va a fallar la primera semana").
  if (input.weeksOfHistory < 2) {
    return { earliestDate: null, likelyDate: null, basis, confidence: "LOW" };
  }

  const now = input.now ?? new Date();
  if (input.currentAmount >= input.thresholdAmount) {
    return { earliestDate: now, likelyDate: now, basis, confidence: "HIGH" };
  }

  const remaining = input.thresholdAmount - input.currentAmount;
  const optimisticRates: Record<number, number> = {};
  for (let d = 0; d < 7; d++) {
    optimisticRates[d] = (input.dailyCashByWeekday[d] ?? 0) + (input.dailyCashStddevByWeekday?.[d] ?? 0);
  }

  const likelyDate = walkToThreshold(remaining, input.dailyCashByWeekday, now);
  const earliestDate = walkToThreshold(remaining, optimisticRates, now);
  const confidence: ThresholdProjection["confidence"] =
    likelyDate === null ? (input.weeksOfHistory >= 4 ? "MEDIUM" : "LOW") : input.weeksOfHistory >= 4 ? "HIGH" : "MEDIUM";

  return { earliestDate, likelyDate, basis, confidence };
}

/* ── §2.3 · Lo raro — pura, sin DB ────────────────────────────────────── */

export type CashAnomaly = {
  kind: "BELOW_TYPICAL_FOR_WEEKDAY";
  message: string;
  todayAmount: number;
  typicalAmount: number;
} | null;

/**
 * Cobro en efectivo muy por debajo de lo normal para ESE día de semana
 * (fuera de dos desviaciones) — "puede ser un día flojo o algo sin
 * registrar; el sistema no decide cuál, solo lo señala" (§2.3).
 */
export function detectBelowTypicalCash(input: {
  todayAmount: number;
  weekday: number;
  meanForWeekday: number;
  stddevForWeekday: number;
  samplesForWeekday: number;
}): CashAnomaly {
  if (input.samplesForWeekday < 3) return null; // muy poca historia para hablar de "típico"
  if (input.stddevForWeekday <= 0) return null; // sin variación medida, no hay con qué comparar
  const deviations = (input.meanForWeekday - input.todayAmount) / input.stddevForWeekday;
  if (deviations <= 2) return null;
  const label = WEEKDAY_LABELS[input.weekday] ?? "hoy";
  return {
    kind: "BELOW_TYPICAL_FOR_WEEKDAY",
    message: `El efectivo de hoy está bastante por debajo de un ${label} típico`,
    todayAmount: round2(input.todayAmount),
    typicalAmount: round2(input.meanForWeekday),
  };
}

/* ── §3 · Estados — pura, sin DB ──────────────────────────────────────── */

export type CashIndicatorState = "ACCUMULATING" | "APPROACHING" | "READY" | "OVERDUE" | "CRITICAL" | "IN_TRANSIT_ONLY" | "CLEAR";

/**
 * Se calcula contra la política de ESA sucursal, nunca contra un umbral
 * global (§3). Sin política configurada, no hay contra qué comparar —
 * ACCUMULATING neutro en vez de inventar un umbral que nadie fijó.
 */
export function computeCashIndicatorState(input: {
  accumulatedAmount: number;
  inTransitAmount: number;
  thresholdAmount: number | null;
  maxDaysHolding: number | null;
  daysSinceOldestRetained: number;
}): CashIndicatorState {
  const { accumulatedAmount, inTransitAmount, thresholdAmount, maxDaysHolding, daysSinceOldestRetained } = input;

  if (accumulatedAmount <= 0.01) {
    return inTransitAmount > 0.01 ? "IN_TRANSIT_ONLY" : "CLEAR";
  }

  if (thresholdAmount === null || thresholdAmount <= 0) return "ACCUMULATING";

  if (accumulatedAmount >= thresholdAmount * 2) return "CRITICAL";
  if (maxDaysHolding !== null && daysSinceOldestRetained > maxDaysHolding) return "OVERDUE";
  if (accumulatedAmount >= thresholdAmount) return "READY";
  if (accumulatedAmount >= thresholdAmount * 0.8) return "APPROACHING";
  if (maxDaysHolding !== null && daysSinceOldestRetained >= maxDaysHolding - 2) return "APPROACHING";
  return "ACCUMULATING";
}

/* ── Historia de cobro en efectivo por día de semana ──────────────────── */

/**
 * Promedio (y desvío) de cobro en efectivo por día de semana, de las
 * últimas `weeks` semanas — la base real de la proyección (§2.2). Se
 * agrupa por `OperationalDay.businessDate`, ya anclado a America/Managua
 * (operations/business-date.ts), en vez de reimplementar el corte de día.
 */
export async function getWeekdayCashHistory(branchId: string, weeks: number, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - weeks * 7 * MS_PER_DAY);
  const rows = await prisma.paymentTender.findMany({
    where: {
      method: PaymentMethod.CASH,
      payment: { status: PaymentStatus.POSTED },
      operationalDay: { branchId, businessDate: { gte: cutoff } },
    },
    select: { amount: true, operationalDay: { select: { businessDate: true } } },
  });

  const byDay = new Map<string, number>(); // "YYYY-MM-DD" -> total del día
  for (const row of rows) {
    if (!row.operationalDay) continue;
    const key = row.operationalDay.businessDate.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + Number(row.amount));
  }

  const totalsByWeekday: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const [key, total] of byDay) {
    const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
    totalsByWeekday[weekday].push(total);
  }

  const meanByWeekday: Record<number, number> = {};
  const stddevByWeekday: Record<number, number> = {};
  const samplesByWeekday: Record<number, number> = {};
  for (let d = 0; d < 7; d++) {
    meanByWeekday[d] = round2(mean(totalsByWeekday[d]));
    stddevByWeekday[d] = round2(stddev(totalsByWeekday[d]));
    samplesByWeekday[d] = totalsByWeekday[d].length;
  }

  return { meanByWeekday, stddevByWeekday, samplesByWeekday, daysObserved: byDay.size };
}

/* ── La posición de efectivo de una sucursal — orquestación ──────────── */

export type BranchCashPosition = {
  branchId: string;
  cashInDrawerToday: number;
  accumulatedAmount: number;
  cashFundAmount: number | null;
  pendingDeposit: number;
  pendingDepositNote: string | null;
  inTransitAmount: number;
  state: CashIndicatorState;
  projection: ThresholdProjection | null;
  anomaly: CashAnomaly;
  policy: { thresholdAmount: number; maxDaysHolding: number } | null;
};

/**
 * Corte de "acumulado": la fecha del último evento que sacó plata retenida
 * de la sucursal (se despachó a custodia o se confirmó un depósito) —
 * antes de eso, ya no cuenta como "sentada sin moverse". Extraída para que
 * getBranchCashPosition y postponeCashDeposit (§7, "consecutivas desde el
 * mismo corte") usen EXACTAMENTE la misma consulta — dos criterios de corte
 * distintos serían dos fuentes de verdad sobre lo mismo.
 */
async function getLastDepositCutoff(db: Prisma.TransactionClient | typeof prisma, branchId: string): Promise<Date | null> {
  const lastDispatchOrConfirm = await db.treasuryEntry.findFirst({
    where: {
      entryType: { in: ["DEPOSIT_DISPATCH", "DEPOSIT_CONFIRMED"] },
      account: { branchId, type: "CUSTODY" },
    },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });
  return lastDispatchOrConfirm?.occurredAt ?? null;
}

export async function getBranchCashPosition(branchId: string, now: Date = new Date()): Promise<BranchCashPosition> {
  const [branch, policy, openSession, custodyAccounts] = await Promise.all([
    prisma.branch.findUniqueOrThrow({ where: { id: branchId }, select: { cashFundAmount: true } }),
    prisma.branchDepositPolicy.findUnique({ where: { branchId } }),
    prisma.cashSession.findFirst({ where: { physicalCashBox: { branchId }, status: "OPEN" }, select: { expectedCashAmount: true } }),
    prisma.treasuryAccount.findMany({ where: { type: "CUSTODY", branchId, isActive: true }, select: { id: true } }),
  ]);

  const cashInDrawerToday = Number(openSession?.expectedCashAmount ?? 0);

  // "En tránsito": saldo de las cuentas CUSTODY de la sucursal.
  let inTransitAmount = 0;
  if (custodyAccounts.length > 0) {
    const [inAgg, outAgg] = await Promise.all([
      prisma.treasuryEntry.aggregate({ where: { accountId: { in: custodyAccounts.map((a) => a.id) }, direction: "IN" }, _sum: { amount: true } }),
      prisma.treasuryEntry.aggregate({ where: { accountId: { in: custodyAccounts.map((a) => a.id) }, direction: "OUT" }, _sum: { amount: true } }),
    ]);
    inTransitAmount = round2(Number(inAgg._sum.amount ?? 0) - Number(outAgg._sum.amount ?? 0));
  }

  const lastDispatchOrConfirmAt = await getLastDepositCutoff(prisma, branchId);

  const retainedDeclarations = await prisma.cashDestinationDeclaration.findMany({
    where: {
      branchId,
      retainAwaitingDepositPortion: { gt: 0 },
      ...(lastDispatchOrConfirmAt ? { createdAt: { gt: lastDispatchOrConfirmAt } } : {}),
    },
    select: { retainAwaitingDepositPortion: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // prompt-tesoreria-gasto-retenido-y-techo.md D-1 — un gasto pagado con
  // efectivo retenido baja el acumulado, con el mismo corte que ya usa esta
  // función para las declaraciones (desde el último despacho/confirmación).
  // No se envejece nada acá — este indicador no calcula antigüedad por
  // declaración, solo el monto total.
  const cashExpensesSinceCutoff = await getActiveRetainedCashExpenses(branchId, lastDispatchOrConfirmAt);
  const totalDeclared = retainedDeclarations.reduce((sum, d) => sum + Number(d.retainAwaitingDepositPortion), 0);
  const totalCashExpenses = cashExpensesSinceCutoff.reduce((sum, e) => sum + e.amount, 0);
  const accumulatedAmount = round2(Math.max(0, totalDeclared - totalCashExpenses));
  const oldestRetainedAt = retainedDeclarations[0]?.createdAt ?? null;
  const daysSinceOldestRetained = oldestRetainedAt ? Math.floor((now.getTime() - oldestRetainedAt.getTime()) / MS_PER_DAY) : 0;

  const cashFundAmount = branch.cashFundAmount === null ? null : Number(branch.cashFundAmount);
  const { amount: pendingDeposit, floorConfigured } = computeAmountToDeposit({
    cashInDrawerToday,
    accumulatedAmount,
    cashFloor: cashFundAmount,
  });
  const pendingDepositNote = floorConfigured ? null : "sin fondo configurado";

  const state = computeCashIndicatorState({
    accumulatedAmount,
    inTransitAmount,
    thresholdAmount: policy ? Number(policy.thresholdAmount) : null,
    maxDaysHolding: policy?.maxDaysHolding ?? null,
    daysSinceOldestRetained,
  });

  let projection: ThresholdProjection | null = null;
  let anomaly: CashAnomaly = null;
  if (policy && (state === "ACCUMULATING" || state === "APPROACHING")) {
    const weeks = 4;
    const history = await getWeekdayCashHistory(branchId, weeks, now);
    const weeksObserved = Math.max(1, Math.round(history.daysObserved / 7));
    projection = projectThresholdReach({
      currentAmount: accumulatedAmount,
      thresholdAmount: Number(policy.thresholdAmount),
      dailyCashByWeekday: history.meanByWeekday,
      dailyCashStddevByWeekday: history.stddevByWeekday,
      weeksOfHistory: weeksObserved,
      now,
    });
  }
  if (state !== "CLEAR") {
    const weekday = now.getUTCDay();
    const history = await getWeekdayCashHistory(branchId, 8, now);
    anomaly = detectBelowTypicalCash({
      todayAmount: cashInDrawerToday,
      weekday,
      meanForWeekday: history.meanByWeekday[weekday] ?? 0,
      stddevForWeekday: history.stddevByWeekday[weekday] ?? 0,
      samplesForWeekday: history.samplesByWeekday[weekday] ?? 0,
    });
  }

  return {
    branchId,
    cashInDrawerToday: round2(cashInDrawerToday),
    accumulatedAmount,
    cashFundAmount,
    pendingDeposit,
    pendingDepositNote,
    inTransitAmount,
    state,
    projection,
    anomaly,
    policy: policy ? { thresholdAmount: Number(policy.thresholdAmount), maxDaysHolding: policy.maxDaysHolding } : null,
  };
}

/* ── §4 · Depositar / entregar sin cerrar la caja ─────────────────────── */

/**
 * Pura — qué posposiciones de una sesión quedaron superadas por un
 * movimiento real, dado lo que queda en gaveta tras ese movimiento. Las
 * MÁS RECIENTES primero (mismo orden que `activePostponementsDesc` debe
 * traer ya aplicado). Aislada para poder probar la decisión de cancelación
 * sin base de datos — mismo principio que computeAccountBalance/
 * computeAmountToDeposit en este módulo.
 */
export function selectSupersededPostponements<T extends { amount: number }>(
  activePostponementsDesc: readonly T[],
  remainingExpectedCash: number,
): T[] {
  let postponedTotal = round2(activePostponementsDesc.reduce((sum, p) => sum + p.amount, 0));
  const superseded: T[] = [];
  for (const postponement of activePostponementsDesc) {
    if (postponedTotal <= remainingExpectedCash + 0.01) break;
    superseded.push(postponement);
    postponedTotal = round2(postponedTotal - postponement.amount);
  }
  return superseded;
}

type SendCashOutInput = {
  cashSessionId: string;
  branchId: string;
  amount: number;
  carrierUserId: string;
  reason: "DEPOSIT_DISPATCH" | "HANDOVER";
  bankAccountId?: string | null;
  actorUserId: string;
};

/**
 * El cuerpo transaccional de sendCashOutToCustody (abajo), separado del
 * wrapper para poder probarlo con un tx en memoria — mismo patrón que
 * postponeCashDepositTx/depositBranchCashDirectTx. Los logAuditEvent (usan
 * el cliente global de Prisma, no `tx`) se movieron al wrapper; el
 * tx.auditLog.create de CASH_MOVEMENT_CREATED se queda acá porque sí
 * escribe contra `tx`.
 */
export async function sendCashOutToCustodyTx(tx: Prisma.TransactionClient, input: SendCashOutInput) {
  // Mismo cuerpo que createCashMovement (cash-session/service.ts), pero
  // reconstruido acá en vez de llamarlo: esa función abre SU PROPIA
  // transacción, y el CashMovement (sale de la gaveta) y la entrada del
  // libro mayor (entra a custodia) tienen que confirmarse juntos o
  // ninguno — si no, hay una ventana donde la plata "desaparece" de la
  // gaveta sin aparecer todavía en tesorería.
  const session = await tx.cashSession.findUniqueOrThrow({
    where: { id: input.cashSessionId },
    include: { physicalCashBox: true },
  });
  if (session.status !== CashSessionStatus.OPEN) throw new Error("CASH_SESSION_NOT_OPEN");
  if (!(await userCanOperateCashSessionTx(tx, { cashSessionId: input.cashSessionId, userId: input.actorUserId, branchId: session.physicalCashBox.branchId }))) {
    throw new Error("CASH_SESSION_OPERATOR_REQUIRED");
  }

  // Validado en el servidor aunque el select del frontend ya filtre — un
  // select filtrado es una comodidad para el usuario, no un control de
  // seguridad, el payload se puede editar.
  let intendedBankAccountId: string | null = null;
  if (input.reason === "DEPOSIT_DISPATCH") {
    if (!input.bankAccountId) throw new Error("VALIDATION_ERROR: elegí la cuenta destino del depósito");
    const bank = await tx.treasuryAccount.findUniqueOrThrow({ where: { id: input.bankAccountId } });
    if (bank.type !== "BANK") throw new Error("VALIDATION_ERROR: la cuenta destino no es bancaria");
    if (!bank.isActive) throw new Error("VALIDATION_ERROR: la cuenta destino está inactiva");
    if (bank.branchId !== null && bank.branchId !== input.branchId) {
      throw new Error("VALIDATION_ERROR: esa cuenta no pertenece a esta sucursal");
    }
    intendedBankAccountId = bank.id;
  }

  const reasonText = input.reason === "DEPOSIT_DISPATCH" ? "Enviado a depositar (sesión abierta)" : "Entregado en persona (sesión abierta)";
  const movement = await tx.cashMovement.create({
    data: {
      cashSessionId: input.cashSessionId,
      type: CashMovementType.BANK_DEPOSIT_OUT,
      amount: input.amount,
      reason: reasonText,
      createdByUserId: input.actorUserId,
    },
  });
  const snapshot = await syncCashSessionSnapshotTx(tx, session.id);
  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      branchId: session.physicalCashBox.branchId,
      module: "cash_session",
      action: "CASH_MOVEMENT_CREATED",
      entityType: "CashMovement",
      entityId: movement.id,
      metadataJson: { cashSessionId: input.cashSessionId, type: CashMovementType.BANK_DEPOSIT_OUT, amount: input.amount, reason: reasonText },
    },
  });

  // Posposición vs movimiento del mismo dinero: si lo que queda en gaveta
  // tras ESTE movimiento ya no alcanza para cubrir lo pospuesto de esta
  // sesión, esas posposiciones (las más recientes primero) quedaron
  // superadas por un movimiento real. Cancelarlas es más honesto que
  // dejarlas: el dinero efectivamente salió, y dejar el registro convierte
  // el panel de Master en una mentira ("Pospuesto 1x" sobre plata que ya
  // no está pospuesta). No se toca el corte de getBranchCashPosition acá
  // — el DEPOSIT_DISPATCH/HANDOVER de arriba ya es la única TreasuryEntry
  // que debe moverlo; cancelar una posposición no genera ninguna propia.
  const activePostponements = await tx.cashDepositPostponement.findMany({
    where: { cashSessionId: input.cashSessionId },
    orderBy: { createdAt: "desc" },
  });
  const superseded = selectSupersededPostponements(
    activePostponements.map((p) => ({ id: p.id, amount: Number(p.amount) })),
    snapshot.expectedCash,
  );
  const supersededIds = superseded.map((p) => p.id);
  if (supersededIds.length > 0) {
    await tx.cashDepositPostponement.deleteMany({ where: { id: { in: supersededIds } } });
  }

  const custody = await findOrCreateCustodyAccountTx(tx, { holderUserId: input.carrierUserId, branchId: input.branchId });
  const entry = await createTreasuryEntryTx(tx, {
    accountId: custody.id,
    direction: "IN",
    amount: input.amount,
    entryType: input.reason,
    counterpartyType: "EMPLOYEE",
    cashMovementId: movement.id,
    intendedBankAccountId,
    createdByUserId: input.actorUserId,
  });

  return {
    movement,
    custodyAccountId: custody.id,
    treasuryEntryId: entry.id,
    intendedBankAccountId,
    supersededPostponementIds: supersededIds,
    remainingExpectedCash: snapshot.expectedCash,
  };
}

/**
 * "Enviar depósito" o "Entregar en persona" con la sesión ABIERTA (§4).
 * Crea el CashMovement BANK_DEPOSIT_OUT (el efectivo esperado baja, como
 * cualquier salida) y la entrada IN a la CUSTODY del destinatario, unidas
 * por cashMovementId. No crea una fila de depósito aparte: "en tránsito"
 * ya lo dice el saldo de la cuenta CUSTODY — un campo de estado adicional
 * sería un segundo lugar para que ese mismo hecho se desincronice.
 * No cierra la sesión ni el ciclo — eso pasa cuando se confirma el depósito
 * (confirmBankDeposit, ya construido).
 */
export async function sendCashOutToCustody(input: SendCashOutInput) {
  if (input.amount <= 0) throw new Error("VALIDATION_ERROR: el monto debe ser mayor que 0");

  const result = await prisma.$transaction((tx) => sendCashOutToCustodyTx(tx, input));

  if (result.supersededPostponementIds.length > 0) {
    await logAuditEvent({
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "treasury",
      action: "CASH_POSTPONEMENT_SUPERSEDED",
      entityType: "CashMovement",
      entityId: result.movement.id,
      metadataJson: {
        cashSessionId: input.cashSessionId,
        supersededPostponementIds: result.supersededPostponementIds,
        remainingExpectedCash: result.remainingExpectedCash,
        reason: "El efectivo pospuesto quedó superado por un movimiento real (entrega/depósito): ya no cabe en lo que queda en gaveta.",
      },
    });
  }

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "treasury",
    action: "CASH_SENT_MID_SESSION",
    entityType: "CashMovement",
    entityId: result.movement.id,
    metadataJson: {
      cashSessionId: input.cashSessionId,
      amount: input.amount,
      carrierUserId: input.carrierUserId,
      reason: input.reason,
      intendedBankAccountId: result.intendedBankAccountId,
      treasuryEntryId: result.treasuryEntryId,
    },
  });

  return { movement: result.movement, custodyAccountId: result.custodyAccountId, treasuryEntryId: result.treasuryEntryId };
}

/**
 * Posposiciones consecutivas activas de una sucursal, contra un `db`
 * genérico (tx o el prisma global — mismo patrón que getLastDepositCutoff)
 * — para poder probar el reinicio del contador con un tx en memoria sin
 * base de datos real. Mismo corte que getLastDepositCutoff: cuenta las
 * CashDepositPostponement creadas DESPUÉS del último DEPOSIT_DISPATCH/
 * DEPOSIT_CONFIRMED sobre una CUSTODY de la sucursal.
 */
async function countConsecutivePostponementsTx(db: Prisma.TransactionClient | typeof prisma, branchId: string): Promise<number> {
  const cutoff = await getLastDepositCutoff(db, branchId);
  return db.cashDepositPostponement.count({
    where: { branchId, ...(cutoff ? { createdAt: { gt: cutoff } } : {}) },
  });
}

/**
 * Posposiciones consecutivas activas de una sucursal — la usan tanto el
 * resumen del módulo de caja (cashier, su propia sesión) como el panel de
 * Tesorería de Master (Parte 3: si el cajero declara y Master nunca lo ve,
 * posponer es un botón que solo sirve para que la plata se quede quieta
 * sin que nadie se entere).
 */
export async function countConsecutivePostponements(branchId: string): Promise<number> {
  return countConsecutivePostponementsTx(prisma, branchId);
}

/**
 * El cuerpo transaccional de postponeCashDeposit (abajo), separado del
 * wrapper para poder probarlo con un tx en memoria (mismo patrón que
 * recordAccountPaymentTx/depositBranchCashDirectTx) — a diferencia de
 * depositBranchCashDirect, ACÁ todo lo que hace falta ya vive en `tx`
 * (nada usa el cliente global de Prisma), así que el wrapper solo abre la
 * transacción y audita.
 *
 * REGLA CRÍTICA: no crea ninguna TreasuryEntry ni CashMovement. Una entrada
 * DEPOSIT_DISPATCH haría avanzar getLastDepositCutoff y reiniciaría el
 * contador de "días sin depositar" — justo lo que esta función existe para
 * NO hacer. Posponer registra una decisión, no un movimiento.
 *
 * Nunca bloquea: si requiresAttention sale true, se devuelve igual — un
 * cajero sin transporte disponible no puede inventar un depósito, y
 * bloquearlo solo lo empuja a no declarar nada, que es peor.
 */
export async function postponeCashDepositTx(
  tx: Prisma.TransactionClient,
  input: { cashSessionId: string; branchId: string; amount: number; reason?: string | null; actorUserId: string },
) {
  const session = await tx.cashSession.findUniqueOrThrow({
    where: { id: input.cashSessionId },
    include: { physicalCashBox: true },
  });
  if (session.status !== CashSessionStatus.OPEN) throw new Error("CASH_SESSION_NOT_OPEN");
  if (!(await userCanOperateCashSessionTx(tx, { cashSessionId: input.cashSessionId, userId: input.actorUserId, branchId: session.physicalCashBox.branchId }))) {
    throw new Error("CASH_SESSION_OPERATOR_REQUIRED");
  }

  const expectedCash = Number(session.expectedCashAmount ?? 0);
  if (input.amount > expectedCash + 0.01) {
    throw new Error("VALIDATION_ERROR: el monto supera el efectivo esperado en caja");
  }

  const postponedUntil = nextBusinessDayFrom();

  const postponement = await tx.cashDepositPostponement.create({
    data: {
      cashSessionId: input.cashSessionId,
      branchId: input.branchId,
      amount: input.amount,
      reason: input.reason ?? null,
      postponedUntil,
      declaredByUserId: input.actorUserId,
    },
  });

  // Consecutivas: cuántas hay para esta sucursal desde el mismo corte que
  // usa getBranchCashPosition — reusada, no duplicada con otro criterio.
  const consecutiveCount = await countConsecutivePostponementsTx(tx, input.branchId);

  const policy = await tx.branchDepositPolicy.findUnique({ where: { branchId: input.branchId } });
  const requiresAttention = policy !== null && consecutiveCount >= policy.maxDaysHolding;

  return { postponement, consecutiveCount, requiresAttention };
}

export async function postponeCashDeposit(input: {
  cashSessionId: string;
  branchId: string;
  amount: number;
  reason?: string | null;
  actorUserId: string;
}) {
  if (input.amount <= 0) throw new Error("VALIDATION_ERROR: el monto debe ser mayor que 0");

  const result = await prisma.$transaction((tx) => postponeCashDepositTx(tx, input));

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "treasury",
    action: "CASH_DEPOSIT_POSTPONED",
    entityType: "CashDepositPostponement",
    entityId: result.postponement.id,
    metadataJson: {
      amount: input.amount,
      reason: input.reason ?? null,
      postponedUntil: result.postponement.postponedUntil,
      consecutiveCount: result.consecutiveCount,
    },
  });

  return result;
}

/* ── Módulo "Destino del efectivo" (POS/cajero) ───────────────────────── */

export type CashDestinationSummary = {
  session: { id: string; openedAt: Date; expectedCashAmount: number };
  /**
   * Parte C — los tres estados del dinero, no un mismo casillero repetido
   * cuatro veces. Mismo vocabulario que el panel de Tesorería de Master
   * (BANCOS → "En cuenta"/inAccount, POR LIQUIDAR → "Por liquidar"/
   * pendingSettlement): si el POS y Tesorería nombran distinto el mismo
   * dinero, el personal aprende dos sistemas.
   */
  money: {
    /** Lo único que se puede mover — vive en la gaveta física. */
    physical: { inDrawer: number; cashFund: number; availableToMove: number };
    /** TRANSFER — ya está en el banco, no en la gaveta. */
    inAccount: {
      total: number;
      byAccount: Array<{ accountId: string; bankName: string; accountAlias: string; last4: string; amount: number }>;
    };
    /** CARD — en SETTLEMENT, el adquirente todavía no liquidó. */
    pendingSettlement: { total: number };
    /** CREDIT y cualquier método futuro. */
    other: { total: number };
  };
  movements: Array<{ id: string; type: "HANDOVER" | "DEPOSIT_DISPATCH"; amount: number; carrierName: string; bankName: string | null; occurredAt: Date }>;
  postponements: Array<{ id: string; amount: number; reason: string | null; postponedUntil: Date; createdAt: Date }>;
  consecutivePostponements: number;
  policy: { maxDaysHolding: number } | null;
  requiresAttention: boolean;
};

/**
 * El resumen del módulo "Destino del efectivo" — la caja de ESA sesión, no
 * la tesorería de la sucursal (CASHIER no tiene TREASURY_VIEW_BRANCH, y no
 * debería: este endpoint solo expone lo que esa sesión movió, no el resto
 * de la sucursal).
 *
 * money.physical.availableToMove sale del cálculo EN VIVO
 * (calculateExpectedCashForSessionTx), nunca de session.expectedCashAmount
 * — esa columna puede quedar stale (ver offline-sync.service.ts) y mostrar
 * efectivo cobrado con C$0.00 disponible al mismo tiempo era exactamente
 * ese bug. session.expectedCashAmount SÍ viaja en la respuesta tal cual,
 * como dato informativo para detectar la divergencia si vuelve a pasar.
 *
 * Los totales de la sesión (physical/inAccount/pendingSettlement/other)
 * nunca pasan por una ventana de fechas — sumar por método alcanza, no
 * hace falta un weekStart para totalizar UNA sesión. availableToMove ya
 * descuenta el fondo de caja (mismo criterio que decomposeRetainedAmount/
 * computeAmountToDeposit — el fondo se queda en la gaveta para dar vuelto
 * mañana) y los movimientos de hoy (BANK_DEPOSIT_OUT ya está neteado
 * dentro del cálculo en vivo) — inAccount/pendingSettlement NUNCA
 * participan de availableToMove: esa plata no está en la gaveta.
 */
export async function getCashSessionDestinationSummary(cashSessionId: string): Promise<CashDestinationSummary> {
  return prisma.$transaction((tx) => getCashSessionDestinationSummaryTx(tx, cashSessionId));
}

/**
 * El cuerpo transaccional de getCashSessionDestinationSummary (arriba),
 * separado del wrapper para poder probarlo con un tx en memoria — mismo
 * patrón que postponeCashDepositTx/depositBranchCashDirectTx.
 */
export async function getCashSessionDestinationSummaryTx(tx: Prisma.TransactionClient, cashSessionId: string): Promise<CashDestinationSummary> {
  const session = await tx.cashSession.findUniqueOrThrow({
    where: { id: cashSessionId },
    include: { physicalCashBox: true },
  });
  const branchId = session.physicalCashBox.branchId;

  const [branch, snapshot, tenderRows, movementEntries, postponementRows, consecutivePostponements, policy] = await Promise.all([
    tx.branch.findUniqueOrThrow({ where: { id: branchId }, select: { cashFundAmount: true } }),
    calculateExpectedCashForSessionTx(tx, cashSessionId, session.openingAmount),
    tx.paymentTender.findMany({
      where: { payment: { cashSessionId, status: PaymentStatus.POSTED } },
      select: { method: true, amount: true, bankAccountId: true },
    }),
    tx.treasuryEntry.findMany({
      where: { entryType: { in: ["HANDOVER", "DEPOSIT_DISPATCH"] }, cashMovement: { cashSessionId } },
      select: {
        id: true,
        amount: true,
        entryType: true,
        occurredAt: true,
        account: { select: { accountAlias: true, holderUser: { select: { fullName: true } } } },
        intendedBankAccount: { select: { bankName: true } },
      },
      orderBy: { occurredAt: "asc" },
    }),
    tx.cashDepositPostponement.findMany({
      where: { cashSessionId },
      select: { id: true, amount: true, reason: true, postponedUntil: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    countConsecutivePostponementsTx(tx, branchId),
    tx.branchDepositPolicy.findUnique({ where: { branchId }, select: { maxDaysHolding: true } }),
  ]);

  // TRANSFER agrupado por cuenta — Parte A ya exige bankAccountId para todo
  // TRANSFER nuevo; un tender viejo/huérfano sin cuenta (dato histórico
  // previo al fix) cae en `other` en vez de perderse o inventar una cuenta.
  const inAccountByAccountId = new Map<string, number>();
  let pendingSettlementTotal = 0;
  let otherTotal = 0;
  for (const t of tenderRows) {
    const amount = Number(t.amount);
    if (t.method === PaymentMethod.TRANSFER && t.bankAccountId) {
      inAccountByAccountId.set(t.bankAccountId, round2((inAccountByAccountId.get(t.bankAccountId) ?? 0) + amount));
    } else if (t.method === PaymentMethod.CARD) {
      pendingSettlementTotal = round2(pendingSettlementTotal + amount);
    } else if (t.method !== PaymentMethod.CASH) {
      otherTotal = round2(otherTotal + amount);
    }
    // CASH no participa acá — vive en money.physical, ya neteado en snapshot.expectedCash.
  }

  const transferAccountIds = [...inAccountByAccountId.keys()];
  const transferAccounts = transferAccountIds.length > 0
    ? await tx.treasuryAccount.findMany({
        where: { id: { in: transferAccountIds } },
        select: { id: true, bankName: true, accountAlias: true, accountNumber: true },
      })
    : [];
  const accountById = new Map(transferAccounts.map((a) => [a.id, a]));

  const byAccount = [...inAccountByAccountId.entries()]
    .map(([accountId, amount]) => {
      const account = accountById.get(accountId);
      const accountNumber = account?.accountNumber ?? "";
      return {
        accountId,
        bankName: account?.bankName ?? "—",
        accountAlias: account?.accountAlias ?? "—",
        last4: accountNumber.length <= 4 ? accountNumber : accountNumber.slice(-4),
        amount,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const cashFundAmount = Number(branch.cashFundAmount ?? 0);
  const availableToMove = Math.max(0, round2(snapshot.expectedCash - cashFundAmount));

  return {
    session: {
      id: session.id,
      openedAt: session.openedAt,
      expectedCashAmount: Number(session.expectedCashAmount ?? 0),
    },
    money: {
      physical: { inDrawer: round2(snapshot.expectedCash), cashFund: cashFundAmount, availableToMove },
      inAccount: { total: round2(byAccount.reduce((s, a) => s + a.amount, 0)), byAccount },
      pendingSettlement: { total: pendingSettlementTotal },
      other: { total: otherTotal },
    },
    movements: movementEntries.map((e) => ({
      id: e.id,
      type: e.entryType as "HANDOVER" | "DEPOSIT_DISPATCH",
      amount: round2(Number(e.amount)),
      carrierName: e.account.holderUser?.fullName ?? e.account.accountAlias,
      bankName: e.intendedBankAccount?.bankName ?? null,
      occurredAt: e.occurredAt,
    })),
    postponements: postponementRows.map((p) => ({
      id: p.id,
      amount: round2(Number(p.amount)),
      reason: p.reason,
      postponedUntil: p.postponedUntil,
      createdAt: p.createdAt,
    })),
    consecutivePostponements,
    policy: policy ? { maxDaysHolding: policy.maxDaysHolding } : null,
    requiresAttention: policy !== null && consecutivePostponements >= policy.maxDaysHolding,
  };
}

/* ── §5 · Entradas por cuenta — para la pantalla de Tesorería ─────────── */

export async function getTreasuryEntriesByAccount(input: { from: Date; to: Date; branchId?: string | null }) {
  const entries = await prisma.treasuryEntry.findMany({
    where: {
      direction: "IN",
      occurredAt: { gte: input.from, lte: input.to },
      account: { type: { in: ["BANK"] } },
      ...(input.branchId ? { account: { type: "BANK", OR: [{ branchId: input.branchId }, { branchId: null }] } } : {}),
    },
    select: {
      amount: true,
      entryType: true,
      accountId: true,
      account: { select: { id: true, bankName: true, accountAlias: true, accountNumber: true, currencyCode: true } },
    },
  });

  const byAccount = new Map<string, {
    account: { id: string; bankName: string; accountAlias: string; accountNumber: string; currencyCode: string };
    total: number;
    byType: Map<string, { total: number; count: number }>;
  }>();

  for (const entry of entries) {
    if (!byAccount.has(entry.accountId)) {
      byAccount.set(entry.accountId, { account: entry.account, total: 0, byType: new Map() });
    }
    const bucket = byAccount.get(entry.accountId)!;
    const amount = Number(entry.amount);
    bucket.total = round2(bucket.total + amount);
    const typeBucket = bucket.byType.get(entry.entryType) ?? { total: 0, count: 0 };
    typeBucket.total = round2(typeBucket.total + amount);
    typeBucket.count += 1;
    bucket.byType.set(entry.entryType, typeBucket);
  }

  return Array.from(byAccount.values()).map((bucket) => ({
    account: bucket.account,
    total: bucket.total,
    breakdown: Array.from(bucket.byType.entries()).map(([entryType, v]) => ({ entryType, total: v.total, count: v.count })),
  }));
}

/* ── §6 · Resumen de depósitos por cuenta y sucursal, en un rango ────── */

export type DepositSummary = {
  period: { from: Date; to: Date };
  deposited: { total: number; count: number; accountsCount: number };
  byAccount: Array<{
    accountId: string;
    bankName: string;
    accountAlias: string;
    accountNumber: string;
    currencyCode: string;
    total: number;
    count: number;
    lastDepositAt: Date | null;
  }>;
  byBranch: Array<{ branchId: string; branchName: string; total: number; count: number }>;
};

/**
 * Totales de depósito por cuenta y por sucursal en un período — la barra de
 * totales de Tesorería (§Tesorería operativa). `accountsCount` es la
 * cantidad de cuentas DISTINTAS con al menos un depósito, no la cantidad de
 * depósitos — son dos números distintos y la pantalla los usa por separado.
 *
 * `_max: { depositedAt: true }` en el mismo groupBy da "última fecha" sin un
 * findMany aparte — un groupBy más, no uno menos, que reconstruir la misma
 * respuesta con una consulta extra.
 */
export async function getDepositSummary(input: { from: Date; to: Date }): Promise<DepositSummary> {
  const where = { depositedAt: { gte: input.from, lte: input.to } };

  const [byAccountGroup, byBranchGroup] = await Promise.all([
    prisma.bankDeposit.groupBy({
      by: ["bankAccountId"],
      where,
      _sum: { amount: true },
      _count: { _all: true },
      _max: { depositedAt: true },
    }),
    prisma.bankDeposit.groupBy({
      by: ["branchId"],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  if (byAccountGroup.length === 0) {
    return { period: input, deposited: { total: 0, count: 0, accountsCount: 0 }, byAccount: [], byBranch: [] };
  }

  const [accounts, branches] = await Promise.all([
    prisma.treasuryAccount.findMany({
      where: { id: { in: byAccountGroup.map((g) => g.bankAccountId) } },
      select: { id: true, bankName: true, accountAlias: true, accountNumber: true, currencyCode: true },
    }),
    prisma.branch.findMany({
      where: { id: { in: byBranchGroup.map((g) => g.branchId) } },
      select: { id: true, name: true },
    }),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const branchById = new Map(branches.map((b) => [b.id, b]));

  const byAccount = byAccountGroup
    .map((g) => {
      const account = accountById.get(g.bankAccountId);
      return {
        accountId: g.bankAccountId,
        bankName: account?.bankName ?? "—",
        accountAlias: account?.accountAlias ?? "—",
        accountNumber: account?.accountNumber ?? "",
        currencyCode: account?.currencyCode ?? "NIO",
        total: round2(Number(g._sum.amount ?? 0)),
        count: g._count._all,
        lastDepositAt: g._max.depositedAt,
      };
    })
    .sort((a, b) => b.total - a.total);

  const byBranch = byBranchGroup.map((g) => ({
    branchId: g.branchId,
    branchName: branchById.get(g.branchId)?.name ?? "—",
    total: round2(Number(g._sum.amount ?? 0)),
    count: g._count._all,
  }));

  return {
    period: input,
    deposited: {
      total: round2(byAccount.reduce((sum, a) => sum + a.total, 0)),
      count: byAccount.reduce((sum, a) => sum + a.count, 0),
      accountsCount: byAccount.length,
    },
    byAccount,
    byBranch,
  };
}

/* ── Política de depósito (§6.5-equivalente: configuración) ──────────── */

export async function setBranchDepositPolicy(input: { branchId: string; thresholdAmount: number; maxDaysHolding: number; actorUserId: string }) {
  const policy = await prisma.branchDepositPolicy.upsert({
    where: { branchId: input.branchId },
    create: { branchId: input.branchId, thresholdAmount: input.thresholdAmount, maxDaysHolding: input.maxDaysHolding },
    update: { thresholdAmount: input.thresholdAmount, maxDaysHolding: input.maxDaysHolding },
  });
  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "treasury",
    action: "BRANCH_DEPOSIT_POLICY_SET",
    entityType: "BranchDepositPolicy",
    entityId: policy.id,
    metadataJson: { thresholdAmount: input.thresholdAmount, maxDaysHolding: input.maxDaysHolding },
  });
  return policy;
}

export async function listBranchDepositPolicies() {
  return prisma.branchDepositPolicy.findMany();
}
