import { Prisma, PrismaClient, MultiBranchIntakeKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createOpeningBalanceTx, createManualInventoryAdjustmentTx } from "@/modules/inventory/service";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Parte B.2 (prompt-completo-pendientes-2026-10.md) — "mismas líneas,
 * cantidad por sucursal ajustable, reintento sin duplicar". A diferencia de
 * PurchaseOrderGroup (una sola transacción liviana), esto es UNA
 * TRANSACCIÓN POR SUCURSAL: createOpeningBalanceTx/createManualInventoryAdjustmentTx
 * recalculan WAC/costo por línea — una transacción gigante para 5
 * sucursales × 50 productos arriesga un 504 en Vercel (mismo motivo por el
 * que createOpeningBalanceBulk ya evita una transacción por todo el lote).
 * Cada sucursal termina DONE o FAILED con su propio error; una que falla
 * no tumba las demás, y /retry solo reprocesa las FAILED.
 */
export const INTAKE_REFERENCE_TYPE = "MULTI_BRANCH_INTAKE";

export type IntakeLineInput = {
  productId: string;
  quantity: number;
  overrides?: Record<string, number>;
  unitCost?: number;
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

export type IntakeBranchResult = { branchId: string; status: "DONE" | "FAILED"; error: string | null };
export type CreateIntakeResult = { intake: { id: string; code: string }; branches: IntakeBranchResult[] };

function quantityForBranch(line: IntakeLineInput, branchId: string): number {
  return line.overrides && branchId in line.overrides ? line.overrides[branchId] : line.quantity;
}

function validateInput(input: CreateIntakeInput) {
  if (input.branchIds.length < 2) throw new Error("VALIDATION_ERROR: Un ingreso multisucursal necesita al menos 2 sucursales — con una, usa el flujo normal.");
  if (new Set(input.branchIds).size !== input.branchIds.length) throw new Error("VALIDATION_ERROR: Hay sucursales repetidas.");
  if (input.lines.length === 0) throw new Error("VALIDATION_ERROR: Agrega al menos un producto.");
  if (!input.reason.trim()) throw new Error("VALIDATION_ERROR: El motivo es obligatorio.");
  const seen = new Set<string>();
  for (const line of input.lines) {
    if (seen.has(line.productId)) throw new Error(`VALIDATION_ERROR: El producto ${line.productId} está repetido.`);
    seen.add(line.productId);
    if (!(line.quantity > 0)) throw new Error("VALIDATION_ERROR: La cantidad para todas debe ser mayor a 0.");
    // OPENING_BALANCE es carga inicial — la sucursal normalmente no tiene WAC
    // previo para ese producto, así que el costo no es opcional (a diferencia
    // de ADJUSTMENT_IN, que reutiliza el WAC ya existente en esa sucursal).
    if (input.kind === "OPENING_BALANCE" && !(line.unitCost !== undefined && line.unitCost > 0)) {
      throw new Error(`VALIDATION_ERROR: El producto ${line.productId} necesita un costo mayor a 0 para carga inicial.`);
    }
  }
}

async function nextIntakeCodeTx(tx: Prisma.TransactionClient): Promise<{ code: string; sequence: number }> {
  const last = await tx.multiBranchIntake.findFirst({ orderBy: { sequence: "desc" }, select: { sequence: true } });
  const sequence = (last?.sequence ?? 0) + 1;
  return { code: `IM-${String(sequence).padStart(6, "0")}`, sequence };
}

/** Procesa UNA sucursal, en SU PROPIA transacción — nunca comparte tx con otra sucursal. */
async function processBranchTx(
  db: PrismaClient,
  intake: { id: string; kind: MultiBranchIntakeKind; reason: string },
  branchId: string,
  lines: IntakeLineInput[],
  actorUserId: string,
  notes: string | null,
) {
  const branchLines = lines
    .map((line) => ({ ...line, quantity: quantityForBranch(line, branchId) }))
    .filter((line) => line.quantity > 0);

  if (branchLines.length === 0) {
    throw new Error("Sin productos para esta sucursal (todas las cantidades quedaron en 0).");
  }

  await db.$transaction(async (tx) => {
    for (const line of branchLines) {
      if (intake.kind === "OPENING_BALANCE") {
        await createOpeningBalanceTx(tx, {
          actorUserId,
          branchId,
          productId: line.productId,
          quantity: line.quantity,
          stockMode: "ADD_OPENING_STOCK",
          unitCost: line.unitCost ?? null,
          costMode: "SET_BRANCH_COST",
          priceMode: "NO_PRICE_CHANGE",
          reason: intake.reason,
          notes,
        }, { referenceType: INTAKE_REFERENCE_TYPE, referenceId: intake.id, bulkReference: intake.id });
      } else {
        await createManualInventoryAdjustmentTx(tx, {
          actorUserId,
          branchId,
          productId: line.productId,
          adjustmentType: "ADJUSTMENT_IN",
          quantity: line.quantity,
          reason: intake.reason,
          notes,
        }, { referenceType: INTAKE_REFERENCE_TYPE, referenceId: intake.id });
      }
    }
  });
}

export async function createMultiBranchIntake(input: CreateIntakeInput, db: PrismaClient = prisma): Promise<CreateIntakeResult> {
  validateInput(input);

  const existing = await db.multiBranchIntake.findUnique({
    where: { clientRequestId: input.clientRequestId },
    include: { branches: { select: { branchId: true, status: true, error: true } } },
  });
  if (existing) {
    return { intake: { id: existing.id, code: existing.code }, branches: existing.branches.map((b) => ({ branchId: b.branchId, status: b.status as "DONE" | "FAILED", error: b.error })) };
  }

  let intake: { id: string; code: string; kind: MultiBranchIntakeKind; reason: string };
  try {
    intake = await db.$transaction(async (tx) => {
      const { code, sequence } = await nextIntakeCodeTx(tx);
      const created = await tx.multiBranchIntake.create({
        data: {
          code, sequence, clientRequestId: input.clientRequestId, kind: input.kind, reason: input.reason,
          linesJson: input.lines as unknown as Prisma.InputJsonValue, createdByUserId: input.actorUserId,
        },
      });
      await tx.multiBranchIntakeBranch.createMany({ data: input.branchIds.map((branchId) => ({ intakeId: created.id, branchId, status: "PENDING" as const })) });
      return { id: created.id, code: created.code, kind: created.kind, reason: created.reason };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const race = await db.multiBranchIntake.findUnique({ where: { clientRequestId: input.clientRequestId }, include: { branches: { select: { branchId: true, status: true, error: true } } } });
      if (race) return { intake: { id: race.id, code: race.code }, branches: race.branches.map((b) => ({ branchId: b.branchId, status: b.status as "DONE" | "FAILED", error: b.error })) };
    }
    throw error;
  }

  const results: IntakeBranchResult[] = [];
  for (const branchId of input.branchIds) {
    try {
      await processBranchTx(db, intake, branchId, input.lines, input.actorUserId, input.notes ?? null);
      await db.multiBranchIntakeBranch.updateMany({ where: { intakeId: intake.id, branchId, status: "PENDING" }, data: { status: "DONE", processedAt: new Date(), error: null } });
      results.push({ branchId, status: "DONE", error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.multiBranchIntakeBranch.updateMany({ where: { intakeId: intake.id, branchId, status: "PENDING" }, data: { status: "FAILED", processedAt: new Date(), error: message } });
      results.push({ branchId, status: "FAILED", error: message });
    }
  }

  return { intake: { id: intake.id, code: intake.code }, branches: results };
}

/** Reprocesa SOLO las sucursales FAILED — nunca una ya DONE (transición condicionada, igual que el resto de este módulo). */
export async function retryMultiBranchIntake(intakeId: string, actorUserId: string, db: PrismaClient = prisma): Promise<CreateIntakeResult> {
  const intake = await db.multiBranchIntake.findUnique({ where: { id: intakeId }, include: { branches: { select: { branchId: true, status: true, error: true } } } });
  if (!intake) throw new Error("NOT_FOUND: Ingreso multisucursal no encontrado.");

  const lines = intake.linesJson as unknown as IntakeLineInput[];
  const results: IntakeBranchResult[] = [];
  for (const branch of intake.branches) {
    if (branch.status !== "FAILED") {
      results.push({ branchId: branch.branchId, status: branch.status as "DONE" | "FAILED", error: branch.error });
      continue;
    }
    // Transición condicionada: solo si SIGUE FAILED en este momento (otro retry concurrente no la reprocesa dos veces).
    const claimed = await db.multiBranchIntakeBranch.updateMany({ where: { intakeId, branchId: branch.branchId, status: "FAILED" }, data: { status: "PENDING" } });
    if (claimed.count === 0) {
      results.push({ branchId: branch.branchId, status: branch.status as "DONE" | "FAILED", error: branch.error });
      continue;
    }
    try {
      await processBranchTx(db, intake, branch.branchId, lines, actorUserId, null);
      await db.multiBranchIntakeBranch.updateMany({ where: { intakeId, branchId: branch.branchId, status: "PENDING" }, data: { status: "DONE", processedAt: new Date(), error: null } });
      results.push({ branchId: branch.branchId, status: "DONE", error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.multiBranchIntakeBranch.updateMany({ where: { intakeId, branchId: branch.branchId, status: "PENDING" }, data: { status: "FAILED", processedAt: new Date(), error: message } });
      results.push({ branchId: branch.branchId, status: "FAILED", error: message });
    }
  }
  return { intake: { id: intake.id, code: intake.code }, branches: results };
}

export async function getMultiBranchIntake(id: string, db: DbClient = prisma) {
  const intake = await db.multiBranchIntake.findUnique({
    where: { id },
    include: { branches: { include: { branch: { select: { id: true, code: true, name: true } } } } },
  });
  if (!intake) throw new Error("NOT_FOUND: Ingreso multisucursal no encontrado.");
  return intake;
}

export async function listMultiBranchIntakes(input: { limit: number; cursor?: string }, db: DbClient = prisma) {
  const intakes = await db.multiBranchIntake.findMany({
    orderBy: { createdAt: "desc" },
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: { branches: { include: { branch: { select: { code: true } } } } },
  });
  const hasMore = intakes.length > input.limit;
  const page = hasMore ? intakes.slice(0, input.limit) : intakes;
  return { intakes: page, nextCursor: hasMore ? page.at(-1)?.id ?? null : null };
}
