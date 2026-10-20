import { Prisma, PrismaClient, MultiBranchIntakeKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createOpeningBalanceTx } from "@/modules/inventory/service";
import { getSharedInventoryBalance } from "@/modules/inventory/unit-conversion";

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
  /** Fase 2 — "⋯ → Cambiar precio de venta", opcional, por línea (mismo valor para todas las sucursales de esa línea). */
  salePrice?: number;
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
};

export type IntakeBranchResult = {
  branchId: string;
  status: "PENDING" | "IN_PROGRESS" | "DONE" | "FAILED";
  error: string | null;
  processedLines: number;
  totalLines: number;
};
export type CreateIntakeResult = {
  intake: { id: string; code: string };
  /** DONE = todas las sucursales terminaron (con o sin error); IN_PROGRESS = el presupuesto de tiempo se agotó antes — llamar a /continue. */
  overallStatus: "DONE" | "IN_PROGRESS";
  branches: IntakeBranchResult[];
};

function quantityForBranch(line: IntakeLineInput, branchId: string): number {
  return line.overrides && branchId in line.overrides ? line.overrides[branchId] : line.quantity;
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

type ResolvedLine = { productId: string; quantity: number; unitCost?: number; salePrice?: number; unit?: string };

/**
 * Líneas de ESTA sucursal, con el override ya resuelto. Para ADD_STOCK/
 * OPENING_BALANCE, una cantidad resuelta <= 0 significa "nada que hacer acá"
 * y se omite (mismo criterio de siempre). Para PHYSICAL_COUNT, 0 es un
 * conteo REAL (deja el producto en cero) — nunca se omite.
 */
function resolveLinesForBranch(lines: IntakeLineInput[], branchId: string, kind: NormalizedIntakeKind): ResolvedLine[] {
  return lines
    .map((line) => ({ productId: line.productId, quantity: quantityForBranch(line, branchId), unitCost: line.unitCost, salePrice: line.salePrice, unit: line.unit }))
    .filter((line) => (kind === "PHYSICAL_COUNT" ? line.quantity >= 0 : line.quantity > 0));
}

/** Procesa UNA tanda (<=25 líneas) en SU PROPIA transacción. */
async function processBatchTx(
  db: PrismaClient,
  kind: NormalizedIntakeKind,
  intake: { id: string; reason: string },
  branchId: string,
  batch: ResolvedLine[],
  actorUserId: string,
  notes: string | null,
) {
  await db.$transaction(async (tx) => {
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
      const hasCost = line.unitCost !== undefined && line.unitCost > 0;
      await createOpeningBalanceTx(tx, {
        actorUserId,
        branchId,
        productId: line.productId,
        quantity: line.quantity,
        unit: line.unit,
        stockMode: stockModeForKind(kind),
        unitCost: hasCost ? line.unitCost : null,
        costMode: costModeForKind(kind, hasCost),
        salePrice: line.salePrice ?? null,
        priceMode: line.salePrice !== undefined && line.salePrice > 0 ? "SET_BRANCH_PRICE" : "NO_PRICE_CHANGE",
        reason: intake.reason,
        notes,
      }, { referenceType: INTAKE_REFERENCE_TYPE, referenceId: intake.id, bulkReference: intake.id });
    }
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
  lines: IntakeLineInput[],
  actorUserId: string,
  notes: string | null,
  deadlineAt: number,
): Promise<IntakeBranchResult> {
  const resolved = resolveLinesForBranch(lines, branchId, kind);
  const totalLines = resolved.length;

  if (totalLines === 0) {
    await db.multiBranchIntakeBranch.updateMany({ where: { intakeId: intake.id, branchId }, data: { status: "FAILED", error: "Sin productos para esta sucursal (todas las cantidades quedaron sin aplicar).", totalLines: 0, processedAt: new Date() } });
    return { branchId, status: "FAILED", error: "Sin productos para esta sucursal (todas las cantidades quedaron sin aplicar).", processedLines: 0, totalLines: 0 };
  }

  await db.multiBranchIntakeBranch.updateMany({ where: { intakeId: intake.id, branchId, totalLines: 0 }, data: { totalLines } });

  let processedLines = (await db.multiBranchIntakeBranch.findUniqueOrThrow({ where: { intakeId_branchId: { intakeId: intake.id, branchId } }, select: { processedLines: true } })).processedLines;

  try {
    while (processedLines < totalLines) {
      if (Date.now() > deadlineAt) {
        await db.multiBranchIntakeBranch.updateMany({ where: { intakeId: intake.id, branchId, status: { in: ["PENDING", "IN_PROGRESS"] } }, data: { status: "IN_PROGRESS" } });
        return { branchId, status: "IN_PROGRESS", error: null, processedLines, totalLines };
      }
      const batch = resolved.slice(processedLines, processedLines + BATCH_SIZE);
      await processBatchTx(db, kind, intake, branchId, batch, actorUserId, notes);
      // Condicionado al valor que leímos — si otra corrida ya avanzó esto, no duplica: relee y sigue desde el valor real.
      const advanced = await db.multiBranchIntakeBranch.updateMany({
        where: { intakeId: intake.id, branchId, processedLines },
        data: { processedLines: processedLines + batch.length, status: "IN_PROGRESS" },
      });
      if (advanced.count === 0) {
        processedLines = (await db.multiBranchIntakeBranch.findUniqueOrThrow({ where: { intakeId_branchId: { intakeId: intake.id, branchId } }, select: { processedLines: true } })).processedLines;
        continue;
      }
      processedLines += batch.length;
    }
    await db.multiBranchIntakeBranch.updateMany({ where: { intakeId: intake.id, branchId }, data: { status: "DONE", processedAt: new Date(), error: null } });
    return { branchId, status: "DONE", error: null, processedLines, totalLines };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.multiBranchIntakeBranch.updateMany({ where: { intakeId: intake.id, branchId }, data: { status: "FAILED", error: message, processedAt: new Date() } });
    return { branchId, status: "FAILED", error: message, processedLines, totalLines };
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
  const results: IntakeBranchResult[] = [];
  for (const branchId of branchIds) {
    const result = await processBranchUntilDeadline(db, kind, intake, branchId, lines, actorUserId, notes, deadlineAt);
    results.push(result);
  }
  const overallStatus: CreateIntakeResult["overallStatus"] = results.every((r) => r.status === "DONE" || r.status === "FAILED") ? "DONE" : "IN_PROGRESS";
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
  // Completa con las que ya estaban DONE/FAILED de antes, para devolver el estado de TODAS.
  const alreadyDone = intake.branches.filter((b) => b.status === "DONE" || b.status === "FAILED").map(branchRowToResult);
  const merged = [...alreadyDone, ...result.branches];
  const overallStatus: CreateIntakeResult["overallStatus"] = merged.every((r) => r.status === "DONE" || r.status === "FAILED") ? "DONE" : "IN_PROGRESS";
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
  const overallStatus: CreateIntakeResult["overallStatus"] = merged.every((r) => r.status === "DONE" || r.status === "FAILED") ? "DONE" : "IN_PROGRESS";
  return { intake: result.intake, overallStatus, branches: merged };
}

function branchRowToResult(b: { branchId: string; status: string; error: string | null; processedLines: number; totalLines: number }): IntakeBranchResult {
  return { branchId: b.branchId, status: b.status as IntakeBranchResult["status"], error: b.error, processedLines: b.processedLines, totalLines: b.totalLines };
}

function toResult(intake: { id: string; code: string; branches: Array<{ branchId: string; status: string; error: string | null; processedLines: number; totalLines: number }> }): CreateIntakeResult {
  const branches = intake.branches.map(branchRowToResult);
  const overallStatus: CreateIntakeResult["overallStatus"] = branches.every((r) => r.status === "DONE" || r.status === "FAILED") ? "DONE" : "IN_PROGRESS";
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
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const products = productIds.length > 0
    ? await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, name: true } })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));
  const linesDetail = lines.map((line) => ({ ...line, product: productById.get(line.productId) ?? null }));

  return { ...intake, linesDetail };
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
