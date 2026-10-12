import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createPurchaseOrder, approvePurchaseOrderTx, cancelPurchaseOrderTx } from "@/modules/purchase-orders/service";
import { logAuditEvent } from "@/modules/audit/service";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Parte B.1 (prompt-completo-pendientes-2026-10.md) — "se carga una vez y
 * se reparte a las sucursales elegidas". Una PurchaseOrderGroup es solo el
 * paraguas: cada sucursal elegida se vuelve una PurchaseOrder NORMAL (se
 * aprueba/recibe/paga por sucursal, con el mismo lock y la misma condición
 * de estado que ya existen — createPurchaseOrder/approvePurchaseOrderTx no
 * se tocaron, solo se les pasa `groupId`).
 */

async function nextGroupCodeTx(tx: Prisma.TransactionClient): Promise<{ code: string; sequence: number }> {
  const last = await tx.purchaseOrderGroup.findFirst({ orderBy: { sequence: "desc" }, select: { sequence: true } });
  const sequence = (last?.sequence ?? 0) + 1;
  return { code: `GP-${String(sequence).padStart(6, "0")}`, sequence };
}

export type CreateGroupLineInput = {
  productId: string;
  unitCostBeforeTax: number;
  taxRate?: number;
  unitTaxAmount?: number;
  quantity: number;
  /** branchId → cantidad distinta para ESA sucursal; 0 = esa sucursal no lleva esta línea. */
  overrides?: Record<string, number>;
};

export type CreateGroupInput = {
  clientRequestId: string;
  actorUserId: string;
  branchIds: string[];
  supplierId?: string | null;
  expectedDate?: string | null;
  notes?: string | null;
  lines: CreateGroupLineInput[];
};

export type CreateGroupResult = {
  group: { id: string; code: string };
  orders: Array<{ id: string; orderNumber: string; branchId: string; linesCount: number; total: number }>;
  skipped: Array<{ branchId: string; reason: string }>;
};

function quantityForBranch(line: CreateGroupLineInput, branchId: string): number {
  return line.overrides && branchId in line.overrides ? line.overrides[branchId] : line.quantity;
}

/**
 * Validaciones de forma — antes de tocar la base. El acceso/permiso POR
 * sucursal (si falta en una, 403 con su nombre) es responsabilidad de la
 * ruta: ahí sí hay sesión para preguntarle a canInBranch.
 */
function validateInput(input: CreateGroupInput) {
  if (input.branchIds.length < 2) throw new Error("VALIDATION_ERROR: Un pedido multisucursal necesita al menos 2 sucursales — con una, usa el flujo normal.");
  if (new Set(input.branchIds).size !== input.branchIds.length) throw new Error("VALIDATION_ERROR: Hay sucursales repetidas.");
  if (input.lines.length === 0) throw new Error("VALIDATION_ERROR: Agrega al menos un producto.");
  const seenProducts = new Set<string>();
  for (const line of input.lines) {
    if (seenProducts.has(line.productId)) throw new Error(`VALIDATION_ERROR: El producto ${line.productId} está repetido.`);
    seenProducts.add(line.productId);
    if (!(line.unitCostBeforeTax >= 0)) throw new Error("VALIDATION_ERROR: El costo no puede ser negativo.");
    if (!(line.quantity > 0)) throw new Error("VALIDATION_ERROR: La cantidad para todas debe ser mayor a 0.");
    for (const [branchId, qty] of Object.entries(line.overrides ?? {})) {
      if (!input.branchIds.includes(branchId)) throw new Error(`VALIDATION_ERROR: La sucursal ${branchId} del override no está en la lista de sucursales elegidas.`);
      if (qty < 0) throw new Error("VALIDATION_ERROR: Una cantidad distinta por sucursal no puede ser negativa.");
    }
  }
}

export async function createPurchaseOrderGroup(input: CreateGroupInput, db: PrismaClient = prisma): Promise<CreateGroupResult> {
  validateInput(input);

  // Idempotencia: reintento con el MISMO clientRequestId devuelve el grupo
  // ya creado (200), no un 409 — un doble clic o un reintento de red no duplica nada.
  const existing = await db.purchaseOrderGroup.findUnique({
    where: { clientRequestId: input.clientRequestId },
    include: { orders: { select: { id: true, orderNumber: true, branchId: true, total: true, lines: { select: { id: true } } } } },
  });
  if (existing) {
    return {
      group: { id: existing.id, code: existing.code },
      orders: existing.orders.map((o) => ({ id: o.id, orderNumber: o.orderNumber, branchId: o.branchId, linesCount: o.lines.length, total: Number(o.total) })),
      skipped: [],
    };
  }

  const products = await db.product.findMany({
    where: { id: { in: input.lines.map((l) => l.productId) } },
    select: { id: true, isActive: true, mergedIntoProductId: true, sku: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  for (const line of input.lines) {
    const product = productById.get(line.productId);
    if (!product) throw new Error(`VALIDATION_ERROR: Producto ${line.productId} no encontrado.`);
    if (!product.isActive) throw new Error(`VALIDATION_ERROR: ${product.sku} está inactivo — no se puede comprar.`);
    if (product.mergedIntoProductId) throw new Error(`VALIDATION_ERROR: ${product.sku} fue unificado con otro producto — usa el producto principal.`);
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const { code, sequence } = await nextGroupCodeTx(tx);
      const group = await tx.purchaseOrderGroup.create({
        data: {
          code,
          sequence,
          clientRequestId: input.clientRequestId,
          supplierId: input.supplierId ?? null,
          expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
          notes: input.notes ?? null,
          createdByUserId: input.actorUserId,
        },
      });

      const orders: CreateGroupResult["orders"] = [];
      const skipped: CreateGroupResult["skipped"] = [];

      for (const branchId of input.branchIds) {
        const branchLines = input.lines
          .map((line) => ({ ...line, quantity: quantityForBranch(line, branchId) }))
          .filter((line) => line.quantity > 0);

        if (branchLines.length === 0) {
          skipped.push({ branchId, reason: "Sin productos para esta sucursal (todas las cantidades quedaron en 0)." });
          continue;
        }

        const po = await createPurchaseOrder(
          {
            userId: input.actorUserId,
            branchId,
            groupId: group.id,
            supplierId: input.supplierId ?? null,
            notes: input.notes ?? undefined,
            lines: branchLines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              unitCostBeforeTax: l.unitCostBeforeTax,
              taxRate: l.taxRate,
              unitTaxAmount: l.unitTaxAmount,
            })),
          },
          tx,
        );
        orders.push({ id: po.id, orderNumber: po.orderNumber, branchId, linesCount: po.lines.length, total: Number(po.total) });
      }

      if (orders.length === 0) throw new Error("VALIDATION_ERROR: Ninguna sucursal quedó con productos — revisa las cantidades.");

      return { group: { id: group.id, code: group.code }, orders, skipped };
    });
    // logAuditEvent siempre usa el prisma global (fire-and-forget, con su
    // propio try/catch) — se llama DESPUÉS de que la transacción ya
    // confirmó, nunca desde dentro de ella.
    await logAuditEvent({
      actorUserId: input.actorUserId,
      module: "purchase-orders",
      action: "PURCHASE_ORDER_GROUP_CREATED",
      entityType: "PurchaseOrderGroup",
      entityId: result.group.id,
      metadataJson: { code: result.group.code, orderIds: result.orders.map((o) => o.id), skippedBranchIds: result.skipped.map((s) => s.branchId) },
    });
    return result;
  } catch (error) {
    // Carrera: dos requests con el mismo clientRequestId llegaron casi juntas.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const race = await db.purchaseOrderGroup.findUnique({
        where: { clientRequestId: input.clientRequestId },
        include: { orders: { select: { id: true, orderNumber: true, branchId: true, total: true, lines: { select: { id: true } } } } },
      });
      if (race) {
        return {
          group: { id: race.id, code: race.code },
          orders: race.orders.map((o) => ({ id: o.id, orderNumber: o.orderNumber, branchId: o.branchId, linesCount: o.lines.length, total: Number(o.total) })),
          skipped: [],
        };
      }
    }
    throw error;
  }
}

export async function getPurchaseOrderGroup(id: string, db: DbClient = prisma) {
  const group = await db.purchaseOrderGroup.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true } },
      orders: {
        include: {
          branch: { select: { id: true, code: true, name: true } },
          lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
        },
      },
    },
  });
  if (!group) throw new Error("NOT_FOUND: Grupo de pedido no encontrado.");
  return group;
}

export async function listPurchaseOrderGroups(input: { limit: number; cursor?: string }, db: DbClient = prisma) {
  const groups = await db.purchaseOrderGroup.findMany({
    orderBy: { createdAt: "desc" },
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: {
      supplier: { select: { id: true, name: true } },
      orders: { select: { id: true, status: true, total: true, branch: { select: { code: true } } } },
    },
  });
  const hasMore = groups.length > input.limit;
  const page = hasMore ? groups.slice(0, input.limit) : groups;
  return { groups: page, nextCursor: hasMore ? page.at(-1)?.id ?? null : null };
}

/** Aprueba cada orden DRAFT del grupo, una transacción por orden (mismo criterio que una aprobación individual) — una que falla no tumba las demás. */
export async function approvePurchaseOrderGroup(groupId: string, actorUserId: string, db: PrismaClient = prisma) {
  const group = await db.purchaseOrderGroup.findUnique({ where: { id: groupId }, include: { orders: { select: { id: true, orderNumber: true, status: true, branch: { select: { code: true } } } } } });
  if (!group) throw new Error("NOT_FOUND: Grupo de pedido no encontrado.");

  const approved: string[] = [];
  const failed: Array<{ orderId: string; orderNumber: string; branchCode: string; reason: string }> = [];
  for (const order of group.orders) {
    try {
      await db.$transaction((tx) => approvePurchaseOrderTx(tx, order.id, actorUserId));
      approved.push(order.id);
    } catch (error) {
      failed.push({ orderId: order.id, orderNumber: order.orderNumber, branchCode: order.branch.code, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { approved, failed };
}

/** Cancela cada orden del grupo que todavía se puede cancelar — mismo criterio que una cancelación individual. */
export async function cancelPurchaseOrderGroup(groupId: string, actorUserId: string, db: PrismaClient = prisma) {
  const group = await db.purchaseOrderGroup.findUnique({ where: { id: groupId }, include: { orders: { select: { id: true, orderNumber: true, status: true, branch: { select: { code: true } } } } } });
  if (!group) throw new Error("NOT_FOUND: Grupo de pedido no encontrado.");

  const cancelled: string[] = [];
  const failed: Array<{ orderId: string; orderNumber: string; branchCode: string; reason: string }> = [];
  for (const order of group.orders) {
    if (order.status !== "DRAFT") continue; // "cancela las que todavía se pueden cancelar" — las demás se omiten en silencio, no es un fallo.
    try {
      await db.$transaction((tx) => cancelPurchaseOrderTx(tx, order.id, actorUserId));
      cancelled.push(order.id);
    } catch (error) {
      failed.push({ orderId: order.id, orderNumber: order.orderNumber, branchCode: order.branch.code, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { cancelled, failed };
}

export type UpdateGroupLineInput = CreateGroupLineInput;

/** Edita líneas/cantidades — SOLO si todas las órdenes del grupo siguen en DRAFT. Rehace las líneas de cada orden en una transacción, con FOR UPDATE sobre las órdenes. */
export async function updatePurchaseOrderGroupLines(
  groupId: string,
  input: { lines: UpdateGroupLineInput[] },
  db: PrismaClient = prisma,
) {
  return db.$transaction(async (tx) => {
    // Lock primero (ignora el resultado — solo bloquea las filas), lectura
    // aparte por el ORM: separar las dos hace esto testeable con un fake-db
    // sin tener que simular $queryRaw, y el lock sigue tomándose igual.
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE "groupId" = ${groupId} FOR UPDATE`;
    const orders = await tx.purchaseOrder.findMany({ where: { groupId }, select: { id: true, branchId: true, status: true } });
    if (orders.length === 0) throw new Error("NOT_FOUND: Grupo de pedido no encontrado.");
    const nonDraft = orders.find((o) => o.status !== "DRAFT");
    if (nonDraft) throw new Error(`CONFLICT: La orden de ${nonDraft.branchId} ya no está en borrador — editala directamente.`);

    for (const order of orders) {
      const branchLines = input.lines
        .map((line) => ({ ...line, quantity: quantityForBranch(line, order.branchId) }))
        .filter((line) => line.quantity > 0);

      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: order.id } });
      for (const line of branchLines) {
        const unitCostBeforeTax = new Prisma.Decimal(line.unitCostBeforeTax);
        const quantity = new Prisma.Decimal(line.quantity);
        await tx.purchaseOrderLine.create({
          data: {
            purchaseOrderId: order.id,
            productId: line.productId,
            quantity,
            unitCost: unitCostBeforeTax,
            unitCostBeforeTax,
            subtotal: quantity.mul(unitCostBeforeTax),
          },
        });
      }
      const total = branchLines.reduce((sum, l) => sum + l.quantity * l.unitCostBeforeTax, 0);
      await tx.purchaseOrder.update({ where: { id: order.id }, data: { total: new Prisma.Decimal(total), subtotalBeforeTax: new Prisma.Decimal(total) } });
    }

    return { updated: orders.length };
  });
}
