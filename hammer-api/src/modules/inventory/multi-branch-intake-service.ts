import { Prisma, PrismaClient, MultiBranchIntakeKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createOpeningBalanceTx } from "@/modules/inventory/service";
import { getSharedInventoryBalance } from "@/modules/inventory/unit-conversion";
import { resolveInboundUnitCostBatch } from "@/modules/inventory/resolve-inbound-unit-cost";
import { mapIntakeErrorToSpanish, buildIntakeErrorJson, type IntakeErrorJson, type IntakeErrorLine } from "@/modules/inventory/intake-error-messages";
import { logAuditEvent } from "@/modules/audit/service";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Fase 1 (prompt-entrada-inventario.md) — "un solo documento de entrada,
 * idempotente, con vista previa real". Reescribe Parte B.2
 * (prompt-completo-pendientes-2026-10.md): sigue siendo UNA TRANSACCIÓN POR
 * TANDA (nunca una transacción gigante por sucursal — timeouts de función
 * serverless en Vercel), pero ahora las tandas son de 25 líneas,
 * reanudables (processedLines), y los 3 `kind` (ADD_STOCK, PHYSICAL_COUNT,
 * OPENING_BALANCE) pasan TODOS por createOpeningBalanceTx (inventory/service.ts)
 * — ya soporta exactamente los stockMode/costMode que hacen falta, no hay
 * que reimplementar nada. ADJUSTMENT_IN (el kind viejo) se trata como alias
 * de ADD_STOCK; nada nuevo lo escribe.
 */
export const INTAKE_REFERENCE_TYPE = "MULTI_BRANCH_INTAKE";

/** Tandas chicas — una transacción por tanda, nunca una por todo el lote (riesgo de 504 en Vercel). */
const BATCH_SIZE = 25;
/** Presupuesto de tiempo por invocación — deja margen bajo el límite de función serverless; lo que no alcanza, lo retoma /continue. */
const PROCESSING_TIME_BUDGET_MS = 8000;

export type NormalizedIntakeKind = "ADD_STOCK" | "PHYSICAL_COUNT" | "OPENING_BALANCE";

/** ADJUSTMENT_IN (kind viejo, Parte B.2) se lee igual que ADD_STOCK — nunca se vuelve a escribir. */
export function normalizeIntakeKind(kind: MultiBranchIntakeKind): NormalizedIntakeKind {
  if (kind === "ADJUSTMENT_IN") return "ADD_STOCK";
  return kind as NormalizedIntakeKind;
}

/** Tabla 1.1 — "mapeo a lo que ya existe, sin reimplementar nada". */
export function stockModeForKind(kind: NormalizedIntakeKind): "SET_PHYSICAL_STOCK" | "ADD_TO_STOCK" {
  return kind === "ADD_STOCK" ? "ADD_TO_STOCK" : "SET_PHYSICAL_STOCK";
}

/** `hasCost` = la línea trae un costo > 0 para ESTA sucursal (quantityForBranch ya resuelto; unitCost es el mismo para todas las sucursales de una línea). */
export function costModeForKind(kind: NormalizedIntakeKind, hasCost: boolean): "BLEND" | "SET_BRANCH_COST" | "QUANTITY_ONLY" {
  if (kind === "OPENING_BALANCE") return "SET_BRANCH_COST";
  if (kind === "PHYSICAL_COUNT") return "QUANTITY_ONLY"; // "un conteo no cambia el costo"
  return hasCost ? "BLEND" : "QUANTITY_ONLY"; // ADD_STOCK con costo: BLEND (alias público, claro, de SET_WAC — createOpeningBalanceTx trata ambos idéntico)
}

export type IntakeLineInput = {
  productId: string;
  quantity: number;
  overrides?: Record<string, number>;
  unitCost?: number;
  /** Precio de venta "para todas" — gana `salePriceOverrides` de esa sucursal, si existe. */
  salePrice?: number;
  /** Commit 3 (prompt-entrada-reintento-precio.md) — columna "Precio de venta {sucursal}", mismo patrón que `overrides` de cantidad. */
  salePriceOverrides?: Record<string, number>;
  /** Selector de unidad, si el producto tiene conversión — igual que hoy. */
  unit?: string;
};

export type CreateIntakeInput = {
  clientRequestId: string;
  actorUserId: string;
  kind: MultiBranchIntakeKind;
  reason: string;
  notes?: string | null;
  branchIds: string[];
  lines: IntakeLineInput[];
  /** Commit 2 §4 — "Crear nueva igual": salta el aviso de posible duplicado y crea de todos modos. */
  confirmDuplicate?: boolean;
};

export type IntakeBranchResult = {
  branchId: string;
  status: "PENDING" | "IN_PROGRESS" | "DONE" | "FAILED" | "DISCARDED";
  error: string | null;
  /** prompt-entrada-reintento-precio.md Commit 1 §3 — lista completa de problemas, en español, con el producto. null en branches no-FAILED o de antes de este commit. */
  errorJson: IntakeErrorJson | null;
  processedLines: number;
  totalLines: number;
};
export type CreateIntakeResult = {
  intake: { id: string; code: string };
  /**
   * prompt-entrada-reintento-precio.md Commit 2 §5 — antes "DONE" se usaba
   * para "todas las sucursales terminaron", aunque alguna haya terminado
   * en FAILED (parecía completa sin estarlo). Ahora: DONE = todas DONE o
   * DISCARDED (de verdad completa); DONE_WITH_FAILURES = todas terminaron
   * pero al menos una sigue FAILED ("Con fallas"); IN_PROGRESS = el
   * presupuesto de tiempo se agotó antes — llamar a /continue.
   */
  overallStatus: "DONE" | "DONE_WITH_FAILURES" | "IN_PROGRESS";
  branches: IntakeBranchResult[];
};

function quantityForBranch(line: IntakeLineInput, branchId: string): number {
  return line.overrides && branchId in line.overrides ? line.overrides[branchId] : line.quantity;
}

/** Commit 3 — mismo patrón que quantityForBranch: el override de ESA sucursal gana sobre el precio "para todas". */
function salePriceForBranch(line: IntakeLineInput, branchId: string): number | undefined {
  return line.salePriceOverrides && branchId in line.salePriceOverrides ? line.salePriceOverrides[branchId] : line.salePrice;
}

function validateInput(input: CreateIntakeInput) {
  if (input.branchIds.length < 1) throw new Error("VALIDATION_ERROR: Elegí al menos una sucursal.");
  if (new Set(input.branchIds).size !== input.branchIds.length) throw new Error("VALIDATION_ERROR: Hay sucursales repetidas.");
  if (input.lines.length === 0) throw new Error("VALIDATION_ERROR: Agrega al menos un producto.");
  if (!input.reason.trim()) throw new Error("VALIDATION_ERROR: El motivo es obligatorio.");

  const kind = normalizeIntakeKind(input.kind);
  const seen = new Set<string>();
  for (const line of input.lines) {
    if (seen.has(line.productId)) throw new Error(`VALIDATION_ERROR: El producto ${line.productId} está repetido.`);
    seen.add(line.productId);

    // prompt-entrada-multisucursal-fix.md — "para todas" vacío (mandado
    // como 0, ver buildIntakePayloadLines) con TODO el valor real puesto en
    // overrides por sucursal (el caso exacto que reportó el dueño: MSY 100,
    // RIV 0) es válido — antes este chequeo solo miraba line.quantity y
    // rechazaba la carga ENTERA. Ahora alcanza con que ALGUNA sucursal
    // elegida resuelva a una cantidad real (0 en ADD_STOCK/OPENING_BALANCE
    // es "no lleva", no cuenta como real).
    const resolvedPerBranch = input.branchIds.map((branchId) => quantityForBranch(line, branchId));
    const hasAnyRealQuantity = kind === "PHYSICAL_COUNT"
      ? resolvedPerBranch.some((q) => q >= 0)
      : resolvedPerBranch.some((q) => q > 0);
    if (!hasAnyRealQuantity) {
      throw new Error(
        kind === "PHYSICAL_COUNT"
          ? `VALIDATION_ERROR: La cantidad para ${line.productId} no puede ser negativa.`
          : `VALIDATION_ERROR: Elegí al menos una sucursal con cantidad para ${line.productId}.`,
      );
    }

    if (kind === "OPENING_BALANCE" && !(line.unitCost !== undefined && line.unitCost > 0)) {
      throw new Error(`VALIDATION_ERROR: El producto ${line.productId} necesita un costo mayor a 0 para carga inicial.`);
    }
  }
}

async function nextIntakeCodeTx(tx: Prisma.TransactionClient): Promise<{ code: string; sequence: number }> {
  const last = await tx.multiBranchIntake.findFirst({ orderBy: { sequence: "desc" }, select: { sequence: true } });
  const sequence = (last?.sequence ?? 0) + 1;
  return { code: `IM-${String(sequence).padStart(6, "0")}`, sequence };
}

export type ResolvedLine = { productId: string; quantity: number; unitCost?: number; salePrice?: number; unit?: string };

/**
 * Líneas de ESTA sucursal, con el override ya resuelto. Para ADD_STOCK/
 * OPENING_BALANCE, una cantidad resuelta <= 0 significa "nada que hacer acá"
 * y se omite (mismo criterio de siempre). Para PHYSICAL_COUNT, 0 es un
 * conteo REAL (deja el producto en cero) — nunca se omite.
 */
function resolveLinesForBranch(lines: IntakeLineInput[], branchId: string, kind: NormalizedIntakeKind): ResolvedLine[] {
  return lines
    .map((line) => ({ productId: line.productId, quantity: quantityForBranch(line, branchId), unitCost: line.unitCost, salePrice: salePriceForBranch(line, branchId), unit: line.unit }))
    .filter((line) => (kind === "PHYSICAL_COUNT" ? line.quantity >= 0 : line.quantity > 0));
}

/**
 * Costo resuelto de cada línea de la tanda, con la MISMA regla que la
 * vista previa (prompt-entrada-reintento-precio.md Commit 1 §1):
 * `resolveInboundUnitCostBatch` — entrado > costo efectivo de ESA
 * sucursal (branchCost > WAC > averageCost > globalCost > lastPurchaseCost,
 * nunca de otra sucursal). Antes, `costModeForKind`+QUANTITY_ONLY dejaba
 * que `createOpeningBalanceTx` cayera al WAC crudo de la sucursal (0 si
 * nunca tuvo compras ahí) sin mirar esta cadena — la causa real de
 * IM-000008: la vista previa veía costo (globalCost=75) y lo dejaba
 * pasar; el guardado solo miraba el WAC de RIV (0) y reventaba.
 */
async function resolveBatchCosts(tx: Prisma.TransactionClient, branchId: string, batch: ResolvedLine[]): Promise<Map<string, Prisma.Decimal | null>> {
  const resolved = await resolveInboundUnitCostBatch(tx, batch.map((line) => ({ productId: line.productId, branchId, enteredCost: line.unitCost ?? null })));
  const costByProductId = new Map<string, Prisma.Decimal | null>();
  for (const line of batch) {
    costByProductId.set(line.productId, resolved.get(`${branchId}:${line.productId}`)?.cost ?? null);
  }
  return costByProductId;
}

type BatchOutcome = "applied" | "alreadyClaimed";

/**
 * Procesa UNA tanda (<=25 líneas) en SU PROPIA transacción — Commit 1 §4
 * (anti-duplicado): el reclamo de `processedLines` (compare-and-swap sobre
 * el valor esperado) pasa a ser el PRIMER paso DENTRO de esta misma
 * transacción, antes de aplicar ninguna línea. Antes, el reclamo era una
 * sentencia SEPARADA después de confirmar la tanda — un corte entre las
 * dos (timeout de Vercel, despliegue) o dos /continue a la vez podían
 * aplicar la misma tanda dos veces (el `updateMany` condicional solo
 * evitaba contar dos veces, no aplicar dos veces). Ahora tanda + avance se
 * confirman juntos o no se confirma nada — si el reclamo no es el
 * esperado (`count===0`), otra corrida ya la tomó: no se toca ni una
 * línea, la transacción (vacía) commitea sin efecto y el llamador relee.
 */
async function processBatchTx(
  db: PrismaClient,
  kind: NormalizedIntakeKind,
  intake: { id: string; reason: string },
  branchId: string,
  batch: ResolvedLine[],
  actorUserId: string,
  notes: string | null,
  expectedProcessedLines: number,
): Promise<BatchOutcome> {
  return db.$transaction(async (tx) => {
    const claim = await tx.multiBranchIntakeBranch.updateMany({
      where: { intakeId: intake.id, branchId, processedLines: expectedProcessedLines },
      data: { processedLines: expectedProcessedLines + batch.length, status: "IN_PROGRESS" },
    });
    if (claim.count === 0) return "alreadyClaimed";

    const costByProductId = kind === "PHYSICAL_COUNT" ? null : await resolveBatchCosts(tx, branchId, batch);

    for (const line of batch) {
      if (kind === "OPENING_BALANCE") {
        // Guarda de servidor — el preview (intake-preview-service.ts) ya
        // avisa esto ANTES de guardar, pero un submit directo (o una
        // carrera entre dos cargas) no debe poder cargar "inicial" sobre
        // existencias reales: eso sería SUMAR disfrazado de apertura.
        const shared = await getSharedInventoryBalance(tx, { branchId, productId: line.productId });
        if (shared.balance && shared.balance.quantityOnHand.gt(0)) {
          throw new Error(`VALIDATION_ERROR: ${line.productId} ya tiene existencias en esta sucursal — usá Sumar o Conteo.`);
        }
      }
      const resolvedCost = costByProductId?.get(line.productId) ?? null;
      const costValue = resolvedCost !== null ? Number(resolvedCost) : null;
      const hasCost = costValue !== null && costValue > 0;
      await createOpeningBalanceTx(tx, {
        actorUserId,
        branchId,
        productId: line.productId,
        quantity: line.quantity,
        unit: line.unit,
        stockMode: stockModeForKind(kind),
        unitCost: hasCost ? costValue : null,
        costMode: costModeForKind(kind, hasCost),
        salePrice: line.salePrice ?? null,
        priceMode: line.salePrice !== undefined && line.salePrice > 0 ? "SET_BRANCH_PRICE" : "NO_PRICE_CHANGE",
        reason: intake.reason,
        notes,
      }, { referenceType: INTAKE_REFERENCE_TYPE, referenceId: intake.id, bulkReference: intake.id });
    }
    return "applied";
  });
}

/**
 * Commit 1 §2 — "prevalidación por sucursal antes de la primera tanda":
 * todas las líneas, con la MISMA regla de costo que la vista previa y que
 * el guardado (resolveInboundUnitCostBatch). Si alguna no resuelve costo
 * (y el movimiento es de entrada — ADD_STOCK siempre, PHYSICAL_COUNT solo
 * si la cantidad sube), la sucursal queda FAILED SIN aplicar nada, con la
 * lista completa. OPENING_BALANCE no entra: validateInput() ya exige
 * costo > 0 ahí mismo, antes de llegar acá.
 */
async function prevalidateBranchLines(
  db: PrismaClient,
  kind: NormalizedIntakeKind,
  branchId: string,
  branchCode: string,
  lines: ResolvedLine[],
): Promise<IntakeErrorLine[]> {
  if (kind === "OPENING_BALANCE") return [];

  const balances = kind === "PHYSICAL_COUNT"
    ? await db.inventoryBalance.findMany({ where: { branchId, productId: { in: lines.map((l) => l.productId) } }, select: { productId: true, quantityOnHand: true } })
    : [];
  const currentQtyByProductId = new Map(balances.map((b) => [b.productId, Number(b.quantityOnHand)]));

  const needsCost = lines.filter((line) => kind === "ADD_STOCK" || (kind === "PHYSICAL_COUNT" && line.quantity > (currentQtyByProductId.get(line.productId) ?? 0)));
  if (needsCost.length === 0) return [];

  const resolved = await resolveInboundUnitCostBatch(db, needsCost.map((line) => ({ productId: line.productId, branchId, enteredCost: line.unitCost ?? null })));
  const missing = needsCost.filter((line) => !(resolved.get(`${branchId}:${line.productId}`)?.cost?.gt(0)));
  if (missing.length === 0) return [];

  const products = await db.product.findMany({ where: { id: { in: missing.map((l) => l.productId) } }, select: { id: true, sku: true, name: true } });
  const productById = new Map(products.map((p) => [p.id, p]));
  return missing.map((line) => {
    const product = productById.get(line.productId);
    return {
      productId: line.productId,
      sku: product?.sku ?? line.productId,
      name: product?.name ?? "(producto)",
      code: "NO_COST_NO_AVERAGE",
      text: `No tiene costo en ${branchCode} y la entrada no traía costo. Escribí el costo de la factura.`,
    };
  });
}

/**
 * Procesa tandas de UNA sucursal hasta terminar o hasta que se acabe
 * `deadlineAt`. Nunca reprocesa una tanda ya confirmada: el avance de
 * `processedLines` está condicionado (`updateMany` con el valor viejo en el
 * `where`), así que una corrida concurrente (dos /continue a la vez) nunca
 * cuenta la misma tanda dos veces.
 */
async function processBranchUntilDeadline(
  db: PrismaClient,
  kind: NormalizedIntakeKind,
  intake: { id: string; reason: string },
  branchId: string,
  branchCode: string,
  lines: IntakeLineInput[],
  actorUserId: string,
  notes: string | null,
  deadlineAt: number,
  /**
   * prompt-entrada-reintento-precio.md Commit 2 §2 — si esta sucursal
   * tiene `linesOverrideJson` (se editó después de fallar), esas líneas
   * YA resueltas para ESTA sucursal reemplazan por completo a `lines` +
   * resolveLinesForBranch — "el override contiene solo las pendientes,
   * que se procesan desde 0 de ese override" (§3).
   */
  overrideLines?: ResolvedLine[],
): Promise<IntakeBranchResult> {
  const resolved = overrideLines ?? resolveLinesForBranch(lines, branchId, kind);

  let processedLines = (await db.multiBranchIntakeBranch.findUniqueOrThrow({ where: { intakeId_branchId: { intakeId: intake.id, branchId } }, select: { processedLines: true } })).processedLines;
  // Commit 2 §3 — "no reinicia processedLines: las líneas ya aplicadas
  // siguen contadas, y el override contiene SOLO las pendientes". `resolved`
  // (el override) es relativo a sí mismo (índice 0 = la primera pendiente);
  // `baseline` traduce ese índice relativo al `processedLines` absoluto que
  // ya traía la sucursal, para seguir avanzando el mismo contador de
  // siempre en vez de inventar uno paralelo. Sin override, baseline=0 y
  // esto se reduce exactamente al comportamiento de antes.
  const baseline = overrideLines ? processedLines : 0;
  const totalLines = baseline + resolved.length;

  if (totalLines === 0) {
    const errorText = "Sin productos para esta sucursal (todas las cantidades quedaron sin aplicar).";
    await db.multiBranchIntakeBranch.updateMany({ where: { intakeId: intake.id, branchId }, data: { status: "FAILED", error: errorText, errorJson: { summary: errorText, lines: [] } as unknown as Prisma.InputJsonValue, totalLines: 0, processedAt: new Date() } });
    return { branchId, status: "FAILED", error: errorText, errorJson: { summary: errorText, lines: [] }, processedLines: 0, totalLines: 0 };
  }

  await db.multiBranchIntakeBranch.updateMany({ where: { intakeId: intake.id, branchId, totalLines: 0 }, data: { totalLines } });

  // Commit 1 §2 — solo antes de la primera tanda DE ESTE conjunto de
  // líneas (processedLines === baseline: nada del override todavía
  // aplicado). Las líneas de ANTES del baseline ya pasaron esta misma
  // prueba cuando se aplicaron; revalidar de nuevo no agrega nada.
  if (processedLines === baseline) {
    const problems = await prevalidateBranchLines(db, kind, branchId, branchCode, resolved);
    if (problems.length > 0) {
      const errorJson = buildIntakeErrorJson(problems);
      await db.multiBranchIntakeBranch.updateMany({ where: { intakeId: intake.id, branchId }, data: { status: "FAILED", error: errorJson.summary, errorJson: errorJson as unknown as Prisma.InputJsonValue, processedAt: new Date() } });
      return { branchId, status: "FAILED", error: errorJson.summary, errorJson, processedLines, totalLines };
    }
  }

  try {
    while (processedLines < totalLines) {
      if (Date.now() > deadlineAt) {
        await db.multiBranchIntakeBranch.updateMany({ where: { intakeId: intake.id, branchId, status: { in: ["PENDING", "IN_PROGRESS"] } }, data: { status: "IN_PROGRESS" } });
        return { branchId, status: "IN_PROGRESS", error: null, errorJson: null, processedLines, totalLines };
      }
      const sliceStart = processedLines - baseline;
      const batch = resolved.slice(sliceStart, sliceStart + BATCH_SIZE);
      const outcome = await processBatchTx(db, kind, intake, branchId, batch, actorUserId, notes, processedLines);
      if (outcome === "alreadyClaimed") {
        // Otra corrida (otro /continue, u otro /retry) ya reclamó y aplicó
        // esta tanda — relee el valor real y sigue desde ahí, sin tocar nada acá.
        processedLines = (await db.multiBranchIntakeBranch.findUniqueOrThrow({ where: { intakeId_branchId: { intakeId: intake.id, branchId } }, select: { processedLines: true } })).processedLines;
        continue;
      }
      processedLines += batch.length;
    }
    await db.multiBranchIntakeBranch.updateMany({ where: { intakeId: intake.id, branchId }, data: { status: "DONE", processedAt: new Date(), error: null, errorJson: Prisma.JsonNull } });
    return { branchId, status: "DONE", error: null, errorJson: null, processedLines, totalLines };
  } catch (error) {
    const { code, text } = mapIntakeErrorToSpanish(error, branchCode);
    const errorJson = buildIntakeErrorJson([{ productId: "", sku: "", name: "", code, text }]);
    await db.multiBranchIntakeBranch.updateMany({ where: { intakeId: intake.id, branchId }, data: { status: "FAILED", error: errorJson.summary, errorJson: errorJson as unknown as Prisma.InputJsonValue, processedAt: new Date() } });
    return { branchId, status: "FAILED", error: errorJson.summary, errorJson, processedLines, totalLines };
  }
}

/**
 * prompt-entrada-multisucursal-fix.md — misma validación que el preview
 * (intake-preview-service.ts), con los mismos motivos: producto inactivo o
 * unificado en otro nunca debería llegar a createOpeningBalanceTx (que no
 * lo chequea — confía en el llamador). Un miembro DERIVADO de una fusión
 * se acepta igual que en el preview: createOpeningBalanceTx ya lo redirige
 * al canónico con el factor.
 *
 * Un producto que NO EXISTE EN ABSOLUTO (id inválido, o uno que se va a
 * crear más tarde) NO se rechaza acá a propósito — eso lo sigue manejando
 * el motor de tandas reanudables como siempre: esa sucursal/tanda queda
 * FAILED (createOpeningBalanceTx ya tira NOT_FOUND) sin tumbar las demás,
 * y un /retry posterior la completa una vez que el producto exista. Mezclar
 * ambos conceptos rompería esa resiliencia (ya probada, Fase 1 de
 * prompt-entrada-inventario.md) sin necesidad — el pedido acá es solo
 * "inactivo o unificado", no "existe".
 */
async function assertProductsIntakeable(db: PrismaClient, productIds: string[]): Promise<void> {
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, isActive: true, mergedIntoProductId: true, mergedInto: { select: { sku: true, name: true } } },
  });
  for (const product of products) {
    if (!product.isActive) throw new Error(`VALIDATION_ERROR: ${product.id} es un producto inactivo.`);
    if (product.mergedIntoProductId) {
      throw new Error(`VALIDATION_ERROR: Este producto se unificó en ${product.mergedInto?.name ?? product.mergedIntoProductId} (${product.mergedInto?.sku ?? ""}): cargá en ese producto.`);
    }
  }
}

const DUPLICATE_LOOKBACK_DAYS = 14;
const DUPLICATE_MATCH_THRESHOLD = 0.8;

export type DuplicateIntakeWarning = {
  intakeId: string;
  code: string;
  branchId: string;
  branchName: string;
  /** 0-100 — productos en común entre ambos pedidos (intersección / unión). */
  matchPercent: number;
};

/**
 * Commit 2 §4 — "aviso de posible duplicado": se detectó, no se bloqueó.
 * El dueño elige "Corregir {code}" (editar la sucursal FAILED, Commit 2 §3)
 * o "Crear nueva igual" (reenvía con confirmDuplicate:true).
 */
export class PossibleDuplicateIntakeError extends Error {
  constructor(public readonly warning: DuplicateIntakeWarning) {
    super("POSSIBLE_DUPLICATE_INTAKE");
    this.name = "PossibleDuplicateIntakeError";
  }
}

/**
 * Commit 2 §4 — "una sucursal FAILED de los últimos 14 días, en alguna de
 * las sucursales elegidas, con ≥80% de los mismos productos". El % se mide
 * como Jaccard (intersección/unión de productIds) para que agregar un
 * producto nuevo a un pedido grande no dispare el aviso, y uno chico
 * calcado de otro grande tampoco lo dispare por "casualidad" de tamaño.
 * Candidatos ya vienen ordenados por más reciente primero — el primero que
 * cruza el umbral es el que se reporta (no hace falta elegir "el mejor").
 */
async function findPossibleDuplicateIntake(db: PrismaClient, branchIds: string[], lines: IntakeLineInput[]): Promise<DuplicateIntakeWarning | null> {
  const since = new Date(Date.now() - DUPLICATE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await db.multiBranchIntakeBranch.findMany({
    where: { branchId: { in: branchIds }, status: "FAILED", intake: { createdAt: { gte: since } } },
    include: { intake: { select: { id: true, code: true, linesJson: true } }, branch: { select: { name: true } } },
    orderBy: { intake: { createdAt: "desc" } },
  });
  if (candidates.length === 0) return null;

  const newProductIds = new Set(lines.map((l) => l.productId));
  for (const candidate of candidates) {
    const candidateProductIds = new Set((candidate.intake.linesJson as unknown as IntakeLineInput[]).map((l) => l.productId));
    const intersectionSize = [...newProductIds].filter((id) => candidateProductIds.has(id)).length;
    const unionSize = new Set([...newProductIds, ...candidateProductIds]).size;
    const matchPercent = unionSize === 0 ? 0 : intersectionSize / unionSize;
    if (matchPercent >= DUPLICATE_MATCH_THRESHOLD) {
      return {
        intakeId: candidate.intake.id,
        code: candidate.intake.code,
        branchId: candidate.branchId,
        branchName: candidate.branch.name,
        matchPercent: Math.round(matchPercent * 100),
      };
    }
  }
  return null;
}

export async function createMultiBranchIntake(input: CreateIntakeInput, db: PrismaClient = prisma): Promise<CreateIntakeResult> {
  validateInput(input);
  await assertProductsIntakeable(db, input.lines.map((l) => l.productId));

  const existing = await db.multiBranchIntake.findUnique({
    where: { clientRequestId: input.clientRequestId },
    include: { branches: true },
  });
  if (existing) {
    return toResult(existing);
  }

  if (!input.confirmDuplicate) {
    const duplicate = await findPossibleDuplicateIntake(db, input.branchIds, input.lines);
    if (duplicate) throw new PossibleDuplicateIntakeError(duplicate);
  }

  let intake: { id: string; code: string; kind: MultiBranchIntakeKind; reason: string; notes: string | null };
  try {
    intake = await db.$transaction(async (tx) => {
      const { code, sequence } = await nextIntakeCodeTx(tx);
      const created = await tx.multiBranchIntake.create({
        data: {
          code, sequence, clientRequestId: input.clientRequestId, kind: input.kind, reason: input.reason, notes: input.notes ?? null,
          linesJson: input.lines as unknown as Prisma.InputJsonValue, createdByUserId: input.actorUserId,
        },
      });
      await tx.multiBranchIntakeBranch.createMany({ data: input.branchIds.map((branchId) => ({ intakeId: created.id, branchId, status: "PENDING" as const })) });
      return { id: created.id, code: created.code, kind: created.kind, reason: created.reason, notes: created.notes };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const race = await db.multiBranchIntake.findUnique({ where: { clientRequestId: input.clientRequestId }, include: { branches: true } });
      if (race) return toResult(race);
    }
    throw error;
  }

  return runBranches(db, intake, input.branchIds, input.lines, input.actorUserId, input.notes ?? null);
}

/** Corre lo que falta de TODAS las sucursales (PENDING o IN_PROGRESS), dentro de un único presupuesto de tiempo compartido. */
async function runBranches(
  db: PrismaClient,
  intake: { id: string; code: string; kind: MultiBranchIntakeKind; reason: string },
  branchIds: string[],
  lines: IntakeLineInput[],
  actorUserId: string,
  notes: string | null,
): Promise<CreateIntakeResult> {
  const kind = normalizeIntakeKind(intake.kind);
  const deadlineAt = Date.now() + PROCESSING_TIME_BUDGET_MS;
  const branchRows = await db.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, code: true } });
  const codeByBranchId = new Map(branchRows.map((b) => [b.id, b.code]));
  // Commit 2 §2/§3 — si alguna de estas sucursales se editó después de
  // fallar, sus líneas pendientes vienen de ACÁ, no del pedido general.
  const overrideRows = await db.multiBranchIntakeBranch.findMany({ where: { intakeId: intake.id, branchId: { in: branchIds }, linesOverrideJson: { not: Prisma.JsonNull } }, select: { branchId: true, linesOverrideJson: true } });
  const overrideByBranchId = new Map(overrideRows.map((r) => [r.branchId, r.linesOverrideJson as unknown as ResolvedLine[]]));
  const results: IntakeBranchResult[] = [];
  for (const branchId of branchIds) {
    const result = await processBranchUntilDeadline(db, kind, intake, branchId, codeByBranchId.get(branchId) ?? branchId, lines, actorUserId, notes, deadlineAt, overrideByBranchId.get(branchId));
    results.push(result);
  }
  const overallStatus = computeOverallStatus(results);
  return { intake: { id: intake.id, code: intake.code }, overallStatus, branches: results };
}

/** /continue — retoma PENDING/IN_PROGRESS (el presupuesto de tiempo se acabó antes de terminar). No toca las ya DONE/FAILED. */
export async function continueMultiBranchIntake(intakeId: string, actorUserId: string, db: PrismaClient = prisma): Promise<CreateIntakeResult> {
  const intake = await db.multiBranchIntake.findUnique({ where: { id: intakeId }, include: { branches: true } });
  if (!intake) throw new Error("NOT_FOUND: Ingreso de inventario no encontrado.");
  const lines = intake.linesJson as unknown as IntakeLineInput[];
  const pendingBranchIds = intake.branches.filter((b) => b.status === "PENDING" || b.status === "IN_PROGRESS").map((b) => b.branchId);
  if (pendingBranchIds.length === 0) return toResult(intake);
  const result = await runBranches(db, intake, pendingBranchIds, lines, actorUserId, intake.notes ?? null);
  // Completa con las que ya estaban DONE/FAILED/DISCARDED de antes, para devolver el estado de TODAS.
  const alreadyDone = intake.branches.filter((b) => b.status === "DONE" || b.status === "FAILED" || b.status === "DISCARDED").map(branchRowToResult);
  const merged = [...alreadyDone, ...result.branches];
  const overallStatus = computeOverallStatus(merged);
  return { intake: result.intake, overallStatus, branches: merged };
}

/** Reprocesa SOLO las sucursales FAILED — mismo motor de tandas reanudables (retoma desde processedLines, no desde cero). */
export async function retryMultiBranchIntake(intakeId: string, actorUserId: string, db: PrismaClient = prisma): Promise<CreateIntakeResult> {
  const intake = await db.multiBranchIntake.findUnique({ where: { id: intakeId }, include: { branches: true } });
  if (!intake) throw new Error("NOT_FOUND: Ingreso de inventario no encontrado.");
  const lines = intake.linesJson as unknown as IntakeLineInput[];

  const failedBranchIds: string[] = [];
  for (const branch of intake.branches) {
    if (branch.status !== "FAILED") continue;
    const claimed = await db.multiBranchIntakeBranch.updateMany({ where: { intakeId, branchId: branch.branchId, status: "FAILED" }, data: { status: "PENDING" } });
    if (claimed.count > 0) failedBranchIds.push(branch.branchId);
  }
  if (failedBranchIds.length === 0) return toResult(intake);

  const result = await runBranches(db, intake, failedBranchIds, lines, actorUserId, intake.notes ?? null);
  const untouched = intake.branches.filter((b) => !failedBranchIds.includes(b.branchId)).map(branchRowToResult);
  const merged = [...untouched, ...result.branches];
  const overallStatus = computeOverallStatus(merged);
  return { intake: result.intake, overallStatus, branches: merged };
}

export type UpdateBranchLinesInput = {
  intakeId: string;
  branchId: string;
  /** Mismo formato que ResolvedLine — SOLO las líneas pendientes corregidas, nunca las que index < processedLines ya aplicó. */
  lines: ResolvedLine[];
  expectedRevision: number;
  actorUserId: string;
};

/**
 * prompt-entrada-reintento-precio.md Commit 2 §3 — `PUT .../branches/:branchId/lines`:
 * "solo si la sucursal está FAILED, con FOR UPDATE y updateMany
 * condicionado a status:FAILED y revision:expectedRevision (si no, 409
 * 'La entrada cambió; recargá')... no reinicia processedLines: las líneas
 * ya aplicadas siguen contadas, y el override contiene solo las
 * pendientes, que se procesan desde 0 de ese override."
 */
export async function updateMultiBranchIntakeBranchLines(input: UpdateBranchLinesInput, db: PrismaClient = prisma): Promise<{ revision: number; processedLines: number; totalLines: number }> {
  if (input.lines.length === 0) throw new Error("VALIDATION_ERROR: Agregá al menos un producto.");

  const before = await db.multiBranchIntakeBranch.findUnique({ where: { intakeId_branchId: { intakeId: input.intakeId, branchId: input.branchId } } });
  if (!before) throw new Error("NOT_FOUND: Sucursal del ingreso no encontrada.");

  const updated = await db.$transaction(async (tx) => {
    // FOR UPDATE — misma fila que el claim de processBatchTx podría estar
    // tocando en ese instante (un /retry corriendo a la vez que se edita).
    await tx.$queryRaw`
      SELECT id FROM "MultiBranchIntakeBranch"
      WHERE "intakeId" = ${input.intakeId} AND "branchId" = ${input.branchId}
      FOR UPDATE
    `;
    const row = await tx.multiBranchIntakeBranch.findUniqueOrThrow({ where: { intakeId_branchId: { intakeId: input.intakeId, branchId: input.branchId } } });
    if (row.status !== "FAILED") throw new Error("CONFLICT: Solo se puede editar una sucursal que falló.");

    const claim = await tx.multiBranchIntakeBranch.updateMany({
      where: { intakeId: input.intakeId, branchId: input.branchId, status: "FAILED", revision: input.expectedRevision },
      data: { linesOverrideJson: input.lines as unknown as Prisma.InputJsonValue, revision: input.expectedRevision + 1 },
    });
    if (claim.count === 0) throw new Error("CONFLICT: La entrada cambió; recargá.");

    return tx.multiBranchIntakeBranch.findUniqueOrThrow({ where: { intakeId_branchId: { intakeId: input.intakeId, branchId: input.branchId } } });
  });

  // logAuditEvent usa el singleton `prisma`, no `tx` — mismo patrón que el
  // resto del módulo (auditoría best-effort, nunca bloquea la operación real).
  await logAuditEvent({
    actorUserId: input.actorUserId,
    module: "inventory",
    action: "MULTI_BRANCH_INTAKE_BRANCH_LINES_EDITED",
    entityType: "MultiBranchIntakeBranch",
    entityId: updated.id,
    metadataJson: { before: before.linesOverrideJson ?? null, after: input.lines, revision: updated.revision },
  });

  return { revision: updated.revision, processedLines: updated.processedLines, totalLines: updated.totalLines };
}

export type DiscardBranchInput = { intakeId: string; branchId: string; reason: string; actorUserId: string };

/**
 * Commit 2 §3 — "POST .../branches/:branchId/discard { reason }: FAILED →
 * DISCARDED... solo si processedLines === 0. Si se aplicó algo, no se
 * descarta: se corrige con otra entrada. El motivo es obligatorio."
 */
export async function discardMultiBranchIntakeBranch(input: DiscardBranchInput, db: PrismaClient = prisma): Promise<void> {
  if (!input.reason.trim()) throw new Error("VALIDATION_ERROR: El motivo es obligatorio.");

  const row = await db.multiBranchIntakeBranch.findUnique({ where: { intakeId_branchId: { intakeId: input.intakeId, branchId: input.branchId } } });
  if (!row) throw new Error("NOT_FOUND: Sucursal del ingreso no encontrada.");
  if (row.status !== "FAILED") throw new Error("CONFLICT: Solo se puede descartar una sucursal que falló.");
  if (row.processedLines > 0) throw new Error("CONFLICT: Ya se aplicaron líneas en esta sucursal — no se puede descartar, corregila con otra entrada.");

  const claim = await db.multiBranchIntakeBranch.updateMany({
    where: { intakeId: input.intakeId, branchId: input.branchId, status: "FAILED", processedLines: 0 },
    data: { status: "DISCARDED", error: `Descartada: ${input.reason.trim()}`, processedAt: new Date() },
  });
  if (claim.count === 0) throw new Error("CONFLICT: La entrada cambió; recargá.");

  await logAuditEvent({
    actorUserId: input.actorUserId,
    module: "inventory",
    action: "MULTI_BRANCH_INTAKE_BRANCH_DISCARDED",
    entityType: "MultiBranchIntakeBranch",
    entityId: row.id,
    metadataJson: { reason: input.reason.trim() },
  });
}

/** Commit 2 §5 — "Completa" (DONE) solo si TODAS terminaron DONE o DISCARDED; "Con fallas" si alguna sigue FAILED; si queda alguna PENDING/IN_PROGRESS, todavía está corriendo. */
function computeOverallStatus(branches: Array<{ status: string }>): CreateIntakeResult["overallStatus"] {
  if (branches.some((b) => b.status === "PENDING" || b.status === "IN_PROGRESS")) return "IN_PROGRESS";
  if (branches.some((b) => b.status === "FAILED")) return "DONE_WITH_FAILURES";
  return "DONE";
}

function branchRowToResult(b: { branchId: string; status: string; error: string | null; errorJson?: Prisma.JsonValue | null; processedLines: number; totalLines: number }): IntakeBranchResult {
  return { branchId: b.branchId, status: b.status as IntakeBranchResult["status"], error: b.error, errorJson: (b.errorJson as unknown as IntakeErrorJson | null) ?? null, processedLines: b.processedLines, totalLines: b.totalLines };
}

function toResult(intake: { id: string; code: string; branches: Array<{ branchId: string; status: string; error: string | null; errorJson?: Prisma.JsonValue | null; processedLines: number; totalLines: number }> }): CreateIntakeResult {
  const branches = intake.branches.map(branchRowToResult);
  const overallStatus = computeOverallStatus(branches);
  return { intake: { id: intake.id, code: intake.code }, overallStatus, branches };
}

/** Detalle de solo lectura (Fase 3) — linesJson solo trae productId; acá se enriquece con sku/name para no obligar a la pantalla a resolverlo aparte. */
export async function getMultiBranchIntake(id: string, db: DbClient = prisma) {
  const intake = await db.multiBranchIntake.findUnique({
    where: { id },
    include: {
      branches: { include: { branch: { select: { id: true, code: true, name: true } } } },
      createdBy: { select: { id: true, fullName: true } },
    },
  });
  if (!intake) throw new Error("NOT_FOUND: Ingreso de inventario no encontrado.");

  const lines = intake.linesJson as unknown as IntakeLineInput[];
  // Commit 2 §2 — "Editar y reintentar" (intake-sheet.tsx en modo edición)
  // necesita sku/name también de los productos que SOLO existen en un
  // override (ej. un reemplazo de un producto descartado) — no están en
  // `lines` (el pedido original), así que se suman a la misma consulta.
  const overrideProductIds = intake.branches.flatMap((b) => ((b.linesOverrideJson as unknown as IntakeLineInput[] | null) ?? []).map((l) => l.productId));
  const productIds = [...new Set([...lines.map((l) => l.productId), ...overrideProductIds])];
  const products = productIds.length > 0
    ? await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, name: true } })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));
  const linesDetail = lines.map((line) => ({ ...line, product: productById.get(line.productId) ?? null }));
  const branchesWithOverrideDetail = intake.branches.map((b) => ({
    ...b,
    overrideLinesDetail: b.linesOverrideJson
      ? (b.linesOverrideJson as unknown as IntakeLineInput[]).map((line) => ({ ...line, product: productById.get(line.productId) ?? null }))
      : null,
  }));

  return { ...intake, branches: branchesWithOverrideDetail, linesDetail };
}

/** Fase 3 (prompt-entrada-inventario.md) — "historial de entradas... tipo, sucursales, líneas, estado, quién y cuándo". */
export async function listMultiBranchIntakes(input: { limit: number; cursor?: string }, db: DbClient = prisma) {
  const intakes = await db.multiBranchIntake.findMany({
    orderBy: { createdAt: "desc" },
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: {
      branches: { include: { branch: { select: { code: true } } } },
      createdBy: { select: { fullName: true } },
    },
  });
  const hasMore = intakes.length > input.limit;
  const page = hasMore ? intakes.slice(0, input.limit) : intakes;
  return { intakes: page, nextCursor: hasMore ? page.at(-1)?.id ?? null : null };
}
