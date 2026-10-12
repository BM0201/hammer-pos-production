import { Prisma, PrismaClient, OrderTemplateKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Parte B.1/B.3 (prompt-completo-pendientes-2026-10.md) — "lo que se pide
 * siempre": una plantilla reusable de líneas (y sucursales, para compras)
 * compartida entre Compras/Ingreso/Traslados por `kind`. Los COSTOS nunca
 * se guardan en la plantilla como verdad vigente — "Usar plantilla" carga
 * productos/cantidades/sucursales, pero el costo se resuelve de nuevo al
 * aplicar (última compra), por eso `linesJson` es solo el esqueleto
 * (productId/quantity/overrides) y un `unitCost` opcional de referencia,
 * nunca lo que de verdad se usa al crear el pedido real.
 */
export type OrderTemplateLine = { productId: string; quantity: number; overrides?: Record<string, number>; unitCost?: number };

export type CreateOrderTemplateInput = {
  name: string;
  kind: OrderTemplateKind;
  supplierId?: string | null;
  branchIds: string[];
  lines: OrderTemplateLine[];
  actorUserId: string;
};

export async function listOrderTemplates(input: { kind?: OrderTemplateKind; includeInactive?: boolean } = {}, db: DbClient = prisma) {
  return db.orderTemplate.findMany({
    where: {
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.includeInactive ? {} : { isActive: true }),
    },
    orderBy: { name: "asc" },
  });
}

export async function createOrderTemplate(input: CreateOrderTemplateInput, db: DbClient = prisma) {
  const name = input.name.trim();
  if (!name) throw new Error("VALIDATION_ERROR: El nombre de la plantilla es obligatorio.");
  if (input.lines.length === 0) throw new Error("VALIDATION_ERROR: Agrega al menos un producto.");

  return db.orderTemplate.create({
    data: {
      name,
      kind: input.kind,
      supplierId: input.supplierId ?? null,
      branchIds: input.branchIds,
      linesJson: input.lines as unknown as Prisma.InputJsonValue,
      createdByUserId: input.actorUserId,
    },
  });
}

export async function updateOrderTemplate(
  id: string,
  input: { name?: string; isActive?: boolean; branchIds?: string[]; lines?: OrderTemplateLine[] },
  db: DbClient = prisma,
) {
  const existing = await db.orderTemplate.findUnique({ where: { id } });
  if (!existing) throw new Error("NOT_FOUND: Plantilla no encontrada.");
  const name = input.name !== undefined ? input.name.trim() : undefined;
  if (name !== undefined && !name) throw new Error("VALIDATION_ERROR: El nombre de la plantilla es obligatorio.");

  return db.orderTemplate.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.branchIds !== undefined ? { branchIds: input.branchIds } : {}),
      ...(input.lines !== undefined ? { linesJson: input.lines as unknown as Prisma.InputJsonValue } : {}),
    },
  });
}

export async function deleteOrderTemplate(id: string, db: DbClient = prisma) {
  const existing = await db.orderTemplate.findUnique({ where: { id } });
  if (!existing) throw new Error("NOT_FOUND: Plantilla no encontrada.");
  await db.orderTemplate.delete({ where: { id } });
}

export type ResolvedOrderTemplate = {
  id: string;
  name: string;
  kind: OrderTemplateKind;
  supplierId: string | null;
  branchIds: string[];
  lines: Array<OrderTemplateLine & { sku: string; name: string }>;
  /** Productos que la plantilla tenía pero ya no se pueden usar (inactivo o unificado) — se sacan, no se bloquea el resto. */
  removedProducts: Array<{ productId: string; reason: string }>;
};

/** "Usar plantilla" / "Repetir pedido" — nunca los costos guardados: solo el esqueleto (producto/cantidad/sucursales), filtrado contra el catálogo VIGENTE. */
export async function resolveOrderTemplateForUse(id: string, db: DbClient = prisma): Promise<ResolvedOrderTemplate> {
  const template = await db.orderTemplate.findUnique({ where: { id } });
  if (!template) throw new Error("NOT_FOUND: Plantilla no encontrada.");

  const lines = (template.linesJson as unknown as OrderTemplateLine[]) ?? [];
  const products = await db.product.findMany({
    where: { id: { in: lines.map((l) => l.productId) } },
    select: { id: true, sku: true, name: true, isActive: true, mergedIntoProductId: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const removedProducts: ResolvedOrderTemplate["removedProducts"] = [];
  const resolvedLines: ResolvedOrderTemplate["lines"] = [];
  for (const line of lines) {
    const product = productById.get(line.productId);
    if (!product) { removedProducts.push({ productId: line.productId, reason: "Ya no existe en el catálogo." }); continue; }
    if (!product.isActive) { removedProducts.push({ productId: line.productId, reason: `${product.sku} está inactivo.` }); continue; }
    if (product.mergedIntoProductId) { removedProducts.push({ productId: line.productId, reason: `${product.sku} fue unificado con otro producto.` }); continue; }
    resolvedLines.push({ ...line, sku: product.sku, name: product.name });
  }

  return {
    id: template.id,
    name: template.name,
    kind: template.kind,
    supplierId: template.supplierId,
    branchIds: template.branchIds,
    lines: resolvedLines,
    removedProducts,
  };
}
