import { Prisma, PrismaClient, StockCountStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findProductByCode } from "@/modules/catalog/service";
import { resolveInventoryProductForMovement, getSharedInventoryBalance, convertSaleQtyToBaseQty } from "@/modules/inventory/unit-conversion";
import { createMultiBranchIntake } from "@/modules/inventory/multi-branch-intake-service";

/**
 * prompt-conteo-delegado.md Commit 1 — "Conteo por escaneo delegado": el
 * contador NUNCA cambia el stock (solo escanea y envía); el stock cambia
 * recién cuando Master/Owner aprueba. Reemplaza, para este flujo, la
 * Entrada PHYSICAL_COUNT directa (que aplica sin borrador ni aprobación) —
 * la aprobación de acá TERMINA generando exactamente esa misma Entrada,
 * reusando multi-branch-intake-service.ts, nunca reimplementando el
 * ajuste de stock.
 */

type DbClient = PrismaClient | Prisma.TransactionClient;

export type CreateStockCountInput = {
  branchId: string;
  title: string;
  categoryIds?: string[];
  blind?: boolean;
  assignedUserIds: string[];
  actorUserId: string;
};

export async function createStockCount(input: CreateStockCountInput, db: PrismaClient = prisma) {
  if (!input.title.trim()) throw new Error("VALIDATION_ERROR: El título es obligatorio.");
  if (input.assignedUserIds.length === 0) throw new Error("VALIDATION_ERROR: Asigná al menos un contador.");

  return db.stockCount.create({
    data: {
      branchId: input.branchId,
      title: input.title.trim(),
      categoryIds: input.categoryIds ?? [],
      blind: input.blind ?? true,
      assignedUserIds: input.assignedUserIds,
      createdById: input.actorUserId,
    },
  });
}

/** Master ve todas las de su alcance; el contador ve solo las OPEN donde está asignado. */
export async function listStockCountsForViewer(input: { branchId?: string; viewerUserId: string; isPrivileged: boolean }, db: PrismaClient = prisma) {
  return db.stockCount.findMany({
    where: {
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.isPrivileged ? {} : { status: "OPEN", assignedUserIds: { has: input.viewerUserId } }),
    },
    orderBy: { createdAt: "desc" },
    include: { branch: { select: { id: true, code: true, name: true } } },
  });
}

/** Campos que el contador NUNCA ve: costo, precio, cantidad del sistema (si blind). Ver test "la ficha y las sugerencias no exponen costo ni precio". */
export type StockCountViewerLine = {
  productId: string;
  productName: string;
  productSku: string;
  countedBase: number;
  scannedUnitLabel: string | null;
  systemBaseAtLastScan: number | null;
  lastScanAt: Date;
};

export async function getStockCountForViewer(id: string, viewer: { isPrivileged: boolean }, db: PrismaClient = prisma) {
  const stockCount = await db.stockCount.findUnique({
    where: { id },
    include: {
      lines: { include: { product: { select: { id: true, name: true, sku: true } } } },
      unknownCodes: true,
      branch: { select: { id: true, code: true, name: true } },
    },
  });
  if (!stockCount) throw new Error("NOT_FOUND: Conteo no encontrado.");

  const lines: StockCountViewerLine[] = stockCount.lines.map((line) => ({
    productId: line.productId,
    productName: line.product.name,
    productSku: line.product.sku,
    countedBase: Number(line.countedBase),
    scannedUnitLabel: line.scannedUnitLabel,
    // Conteo a ciegas (Commit 1 §3) — el contador nunca ve la cantidad del sistema; Master siempre la ve.
    systemBaseAtLastScan: !viewer.isPrivileged && stockCount.blind ? null : (line.systemBaseAtLastScan !== null ? Number(line.systemBaseAtLastScan) : null),
    lastScanAt: line.lastScanAt,
  }));

  return {
    id: stockCount.id,
    branchId: stockCount.branchId,
    branch: stockCount.branch,
    status: stockCount.status,
    title: stockCount.title,
    categoryIds: stockCount.categoryIds,
    blind: stockCount.blind,
    assignedUserIds: stockCount.assignedUserIds,
    createdAt: stockCount.createdAt,
    submittedAt: stockCount.submittedAt,
    reviewedAt: stockCount.reviewedAt,
    reviewNote: stockCount.reviewNote,
    appliedIntakeId: stockCount.appliedIntakeId,
    lines,
    unknownCodes: stockCount.unknownCodes.map((u) => ({ code: u.code, quantity: Number(u.quantity), note: u.note, resolvedProductId: u.resolvedProductId })),
  };
}

/** Quién puede escanear/corregir/enviar en un conteo: Master/Owner/SystemAdmin siempre, o el contador asignado. Usado por las rutas antes de llamar al service. */
export function canAccessStockCount(stockCount: { assignedUserIds: string[] }, actorUserId: string, isPrivileged: boolean): boolean {
  return isPrivileged || stockCount.assignedUserIds.includes(actorUserId);
}

function assertOpenAndAssigned(stockCount: { status: StockCountStatus; assignedUserIds: string[] }, actorUserId: string, isPrivileged: boolean) {
  if (stockCount.status !== "OPEN") throw new Error("CONFLICT: Este conteo ya no está abierto.");
  if (!isPrivileged && !stockCount.assignedUserIds.includes(actorUserId)) throw new Error("FORBIDDEN: No estás asignado a este conteo.");
}

export type ScanStockCountInput = {
  stockCountId: string;
  code: string;
  multiplier: number;
  clientEventId: string;
  deviceLabel?: string;
  actorUserId: string;
  isPrivileged: boolean;
};

export type ScanStockCountResult =
  | { kind: "COUNTED"; productId: string; productName: string; productSku: string; countedBase: number; scannedUnitLabel: string | null; systemBaseAtLastScan: number | null }
  | { kind: "UNKNOWN"; code: string };

/**
 * Commit 1 — "resuelve el código con la misma lógica que by-code (incluye
 * presentaciones de fusión: convierte a unidad base del canónico)".
 * Idempotente por clientEventId: un reintento de red (mismo escaneo
 * mandado dos veces) nunca suma dos veces — se relee el evento ya
 * confirmado y se devuelve el estado actual de la línea, sin tocar nada.
 */
export async function scanStockCount(input: ScanStockCountInput, db: PrismaClient = prisma): Promise<ScanStockCountResult> {
  if (!(input.multiplier > 0)) throw new Error("VALIDATION_ERROR: El multiplicador debe ser mayor a 0.");

  const existingEvent = await db.stockCountEvent.findUnique({ where: { clientEventId: input.clientEventId } });
  if (existingEvent) {
    if (existingEvent.kind === "UNKNOWN_CODE") return { kind: "UNKNOWN", code: existingEvent.code ?? input.code };
    const line = await db.stockCountLine.findUnique({ where: { stockCountId_productId: { stockCountId: input.stockCountId, productId: existingEvent.productId! } }, include: { product: { select: { name: true, sku: true } } } });
    if (line) return { kind: "COUNTED", productId: line.productId, productName: line.product.name, productSku: line.product.sku, countedBase: Number(line.countedBase), scannedUnitLabel: line.scannedUnitLabel, systemBaseAtLastScan: line.systemBaseAtLastScan !== null ? Number(line.systemBaseAtLastScan) : null };
  }

  const stockCount = await db.stockCount.findUnique({ where: { id: input.stockCountId } });
  if (!stockCount) throw new Error("NOT_FOUND: Conteo no encontrado.");
  assertOpenAndAssigned(stockCount, input.actorUserId, input.isPrivileged);

  const { product } = await findProductByCode(input.code, db);
  if (!product) {
    await db.$transaction([
      db.stockCountUnknownCode.upsert({
        where: { stockCountId_code: { stockCountId: input.stockCountId, code: input.code } },
        create: { stockCountId: input.stockCountId, code: input.code, quantity: input.multiplier },
        update: { quantity: { increment: input.multiplier } },
      }),
      db.stockCountEvent.create({ data: { stockCountId: input.stockCountId, code: input.code, delta: input.multiplier, kind: "UNKNOWN_CODE", userId: input.actorUserId, clientEventId: input.clientEventId, deviceLabel: input.deviceLabel } }),
    ]);
    return { kind: "UNKNOWN", code: input.code };
  }

  const { inventoryProductId, conversion } = await resolveInventoryProductForMovement(db, product.id);
  const factor = conversion?.conversionFactor ?? new Prisma.Decimal(1);
  const baseQtyDelta = Number(convertSaleQtyToBaseQty({ quantity: input.multiplier, conversionFactor: factor }));
  const shared = await getSharedInventoryBalance(db, { branchId: stockCount.branchId, productId: product.id });
  const systemBaseNow = shared.balance ? Number(shared.balance.quantityOnHand) : 0;
  const scannedUnitLabel = conversion?.isPackagePresentation ? (conversion.packageUnit ?? conversion.saleUnit) : null;

  const [line] = await db.$transaction([
    db.stockCountLine.upsert({
      where: { stockCountId_productId: { stockCountId: input.stockCountId, productId: inventoryProductId } },
      create: { stockCountId: input.stockCountId, productId: inventoryProductId, countedBase: baseQtyDelta, scannedUnitLabel, systemBaseAtLastScan: systemBaseNow, lastScanAt: new Date(), lastScanById: input.actorUserId },
      update: { countedBase: { increment: baseQtyDelta }, scannedUnitLabel, systemBaseAtLastScan: systemBaseNow, lastScanAt: new Date(), lastScanById: input.actorUserId },
      include: { product: { select: { name: true, sku: true } } },
    }),
    db.stockCountEvent.create({ data: { stockCountId: input.stockCountId, productId: inventoryProductId, code: input.code, delta: baseQtyDelta, kind: "SCAN", userId: input.actorUserId, clientEventId: input.clientEventId, deviceLabel: input.deviceLabel } }),
  ]);

  return { kind: "COUNTED", productId: line.productId, productName: line.product.name, productSku: line.product.sku, countedBase: Number(line.countedBase), scannedUnitLabel: line.scannedUnitLabel, systemBaseAtLastScan: line.systemBaseAtLastScan !== null ? Number(line.systemBaseAtLastScan) : null };
}

export type CorrectStockCountLineInput = {
  stockCountId: string;
  productId: string;
  setTo?: number;
  delta?: number;
  clientEventId: string;
  actorUserId: string;
  isPrivileged: boolean;
};

/** Corrección manual (−1 o cantidad editada) — nunca baja de 0. Idempotente por clientEventId. */
export async function correctStockCountLine(input: CorrectStockCountLineInput, db: PrismaClient = prisma) {
  if (input.setTo === undefined && input.delta === undefined) throw new Error("VALIDATION_ERROR: Mandá setTo o delta.");

  const existingEvent = await db.stockCountEvent.findUnique({ where: { clientEventId: input.clientEventId } });
  if (existingEvent) {
    return db.stockCountLine.findUniqueOrThrow({ where: { stockCountId_productId: { stockCountId: input.stockCountId, productId: input.productId } } });
  }

  const stockCount = await db.stockCount.findUnique({ where: { id: input.stockCountId } });
  if (!stockCount) throw new Error("NOT_FOUND: Conteo no encontrado.");
  assertOpenAndAssigned(stockCount, input.actorUserId, input.isPrivileged);

  const current = await db.stockCountLine.findUnique({ where: { stockCountId_productId: { stockCountId: input.stockCountId, productId: input.productId } } });
  if (!current) throw new Error("NOT_FOUND: Esta línea todavía no tiene ningún escaneo.");

  const currentValue = Number(current.countedBase);
  const nextValue = Math.max(0, input.setTo !== undefined ? input.setTo : currentValue + input.delta!);

  const [line] = await db.$transaction([
    db.stockCountLine.update({ where: { stockCountId_productId: { stockCountId: input.stockCountId, productId: input.productId } }, data: { countedBase: nextValue, lastScanAt: new Date(), lastScanById: input.actorUserId } }),
    db.stockCountEvent.create({ data: { stockCountId: input.stockCountId, productId: input.productId, delta: input.delta ?? null, setTo: input.setTo ?? null, kind: input.setTo !== undefined ? "EDIT" : "MINUS", userId: input.actorUserId, clientEventId: input.clientEventId } }),
  ]);

  return line;
}

/** OPEN → SUBMITTED. updateMany condicional: si ya cambió de estado, count===0 → 409 ALREADY_PROCESSED. */
export async function submitStockCount(id: string, actorUserId: string, isPrivileged: boolean, db: PrismaClient = prisma) {
  const stockCount = await db.stockCount.findUnique({ where: { id } });
  if (!stockCount) throw new Error("NOT_FOUND: Conteo no encontrado.");
  if (!isPrivileged && !stockCount.assignedUserIds.includes(actorUserId)) throw new Error("FORBIDDEN: No estás asignado a este conteo.");

  const claim = await db.stockCount.updateMany({ where: { id, status: "OPEN" }, data: { status: "SUBMITTED", submittedById: actorUserId, submittedAt: new Date() } });
  if (claim.count === 0) throw new Error("ALREADY_PROCESSED: Este conteo ya fue enviado o ya no está abierto.");

  await db.stockCountEvent.create({ data: { stockCountId: id, kind: "SUBMIT", userId: actorUserId, clientEventId: `submit_${id}_${Date.now()}` } });
  return db.stockCount.findUniqueOrThrow({ where: { id } });
}

/**
 * SUBMITTED → APPROVED. Crea UNA Entrada PHYSICAL_COUNT con las líneas CON
 * DIFERENCIA, contra la cantidad del sistema EN EL MOMENTO DE APROBAR —
 * no la del escaneo. La diferencia real (lo que el contador encontró) es
 * invariante a los movimientos posteriores: appliedQty = systemAhora +
 * (contado − systemAlEscanear). Si no hubo ningún movimiento posterior,
 * esto es exactamente "contado"; si sí hubo (ventas/entradas entre el
 * escaneo y la aprobación), el conteo no las borra.
 */
export async function approveStockCount(id: string, actorUserId: string, db: PrismaClient = prisma) {
  const stockCount = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "StockCount" WHERE id = ${id} FOR UPDATE`;
    const row = await tx.stockCount.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    if (row.status !== "SUBMITTED") throw new Error("CONFLICT: Solo se puede aprobar un conteo enviado.");

    const claim = await tx.stockCount.updateMany({ where: { id, status: "SUBMITTED" }, data: { status: "APPROVED", reviewedById: actorUserId, reviewedAt: new Date() } });
    if (claim.count === 0) throw new Error("ALREADY_PROCESSED: Este conteo ya fue procesado.");
    return row;
  });

  const linesWithDiff: Array<{ productId: string; quantity: number }> = [];
  for (const line of stockCount.lines) {
    const shared = await getSharedInventoryBalance(db, { branchId: stockCount.branchId, productId: line.productId });
    const systemNow = shared.balance ? Number(shared.balance.quantityOnHand) : 0;
    const systemAtScan = line.systemBaseAtLastScan !== null ? Number(line.systemBaseAtLastScan) : systemNow;
    const discrepancy = Number(line.countedBase) - systemAtScan;
    if (discrepancy === 0) continue;
    linesWithDiff.push({ productId: line.productId, quantity: Math.max(0, systemNow + discrepancy) });
  }

  if (linesWithDiff.length === 0) {
    await db.stockCountEvent.create({ data: { stockCountId: id, kind: "APPROVE", userId: actorUserId, clientEventId: `approve_${id}_${Date.now()}` } });
    return db.stockCount.findUniqueOrThrow({ where: { id } });
  }

  const intakeResult = await createMultiBranchIntake({
    clientRequestId: `stockcount_${id}`,
    actorUserId,
    kind: "PHYSICAL_COUNT",
    reason: `Conteo ${stockCount.title}`,
    branchIds: [stockCount.branchId],
    lines: linesWithDiff,
  }, db);

  await db.$transaction([
    db.stockCount.update({ where: { id }, data: { appliedIntakeId: intakeResult.intake.id } }),
    db.stockCountEvent.create({ data: { stockCountId: id, kind: "APPROVE", userId: actorUserId, clientEventId: `approve_${id}_${Date.now()}` } }),
  ]);

  // El conteo en sí ya quedó APPROVED (el trabajo del contador terminó ahí)
  // — pero si la Entrada generada falló (ej. un producto recién encontrado
  // sin costo resolvible, mismo caso que IM-000008), avisarlo acá para que
  // el dueño la corrija con "Editar y reintentar" (prompt-entrada-reintento-precio.md
  // Commit 2) en vez de creer que el stock ya quedó ajustado.
  if (intakeResult.overallStatus !== "DONE") {
    return { ...(await db.stockCount.findUniqueOrThrow({ where: { id } })), intakeOverallStatus: intakeResult.overallStatus };
  }

  return db.stockCount.findUniqueOrThrow({ where: { id } });
}

export async function rejectStockCount(id: string, note: string, actorUserId: string, db: PrismaClient = prisma) {
  if (!note.trim()) throw new Error("VALIDATION_ERROR: El motivo es obligatorio.");
  const claim = await db.stockCount.updateMany({ where: { id, status: "SUBMITTED" }, data: { status: "REJECTED", reviewedById: actorUserId, reviewedAt: new Date(), reviewNote: note.trim() } });
  if (claim.count === 0) throw new Error("ALREADY_PROCESSED: Este conteo ya fue procesado.");
  await db.stockCountEvent.create({ data: { stockCountId: id, kind: "REJECT", userId: actorUserId, clientEventId: `reject_${id}_${Date.now()}` } });
  return db.stockCount.findUniqueOrThrow({ where: { id } });
}

/** SUBMITTED → OPEN, para que el contador corrija ("Devolver para corregir"). */
export async function reopenStockCount(id: string, actorUserId: string, db: PrismaClient = prisma) {
  const claim = await db.stockCount.updateMany({ where: { id, status: "SUBMITTED" }, data: { status: "OPEN", submittedById: null, submittedAt: null } });
  if (claim.count === 0) throw new Error("ALREADY_PROCESSED: Este conteo ya fue procesado.");
  await db.stockCountEvent.create({ data: { stockCountId: id, kind: "REOPEN", userId: actorUserId, clientEventId: `reopen_${id}_${Date.now()}` } });
  return db.stockCount.findUniqueOrThrow({ where: { id } });
}
