import { Prisma, type ProductBarcodeKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeScannedCode } from "@/modules/catalog/barcode";
import { BarcodeAlreadyExistsError } from "@/modules/catalog/barcode-errors";

/**
 * prompt-codigos-y-duplicados.md Fase 1 — varios códigos por producto.
 * Product.barcode se mantiene como copia del PRINCIPAL (POS, caché,
 * etiquetas, importación, búsqueda no cambian) — este archivo es el ÚNICO
 * escritor de esa columna desde ahora, igual que setBranchPriceTx es el
 * único escritor de branchPrice. Todo audita adentro del mismo `db`
 * recibido (tx o el prisma global) — nunca el logAuditEvent no
 * transaccional, para que moveBarcode's lock+CAS y su auditoría se
 * confirmen o se reviertan juntos.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * MISMA regla que el backfill de la migración (20261009000000_product_barcodes
 * /migration.sql): un código que ya sigue el patrón HMR- es un código
 * interno nuestro, cualquier otro es de fábrica. Un test cruza este
 * resultado contra el SQL para que no se desincronicen en silencio.
 */
export function classifyBackfillBarcode(code: string): { kind: "FACTORY" | "INTERNAL"; isPrimary: true } {
  return { kind: code.startsWith("HMR-") ? "INTERNAL" : "FACTORY", isPrimary: true };
}

/** Lista los códigos de un producto, principal primero y luego por antigüedad. */
export async function listProductBarcodes(productId: string, db: Db = prisma) {
  return db.productBarcode.findMany({
    where: { productId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
}

async function auditBarcodeEvent(
  db: Db,
  input: { actorUserId: string; action: string; productId: string; metadataJson: Record<string, unknown> },
) {
  await db.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      module: "catalog",
      action: input.action,
      entityType: "Product",
      entityId: input.productId,
      metadataJson: input.metadataJson as Prisma.InputJsonValue,
    },
  });
}

/**
 * Agrega un código a un producto. Si el producto no tenía ningún código
 * todavía, este pasa a ser el principal (y Product.barcode se actualiza en
 * el mismo golpe). Un código que ya es de OTRO producto → 409
 * BarcodeAlreadyExistsError (con si ese producto está activo, para que la
 * pantalla pueda ofrecer "¿son el mismo producto?" distinto de un dato viejo).
 */
export async function addBarcode(
  input: { productId: string; rawCode: string; kind: ProductBarcodeKind; actorUserId: string },
  db: Db = prisma,
): Promise<{ id: string; code: string; kind: ProductBarcodeKind; isPrimary: boolean }> {
  const code = normalizeScannedCode(input.rawCode);
  if (!code) throw new Error("VALIDATION_ERROR: el código no puede estar vacío.");

  const existing = await db.productBarcode.findUnique({
    where: { code },
    select: { productId: true, product: { select: { id: true, name: true, sku: true, isActive: true } } },
  });
  if (existing) {
    if (existing.productId === input.productId) {
      throw new Error("VALIDATION_ERROR: este producto ya tiene ese código.");
    }
    throw new BarcodeAlreadyExistsError(
      `Ya existe un producto con el código "${code}" (${existing.product.name}).`,
      { id: existing.product.id, name: existing.product.name, sku: existing.product.sku, barcode: code, isActive: existing.product.isActive },
    );
  }

  const hasPrimary = await db.productBarcode.findFirst({ where: { productId: input.productId, isPrimary: true }, select: { id: true } });
  const isPrimary = !hasPrimary;

  const created = await db.productBarcode.create({
    data: { productId: input.productId, code, kind: input.kind, isPrimary, createdByUserId: input.actorUserId },
  });

  if (isPrimary) {
    await db.product.update({ where: { id: input.productId }, data: { barcode: code } });
  }

  await auditBarcodeEvent(db, {
    actorUserId: input.actorUserId,
    action: "PRODUCT_BARCODE_ADDED",
    productId: input.productId,
    metadataJson: { barcodeId: created.id, code, kind: input.kind, isPrimary },
  });

  return created;
}

/** Marca un código existente como el principal (y refresca Product.barcode). No-op si ya lo era. */
export async function setPrimaryBarcode(productId: string, barcodeId: string, actorUserId: string, db: Db = prisma) {
  const barcode = await db.productBarcode.findUnique({ where: { id: barcodeId } });
  if (!barcode || barcode.productId !== productId) throw new Error("NOT_FOUND");
  if (barcode.isPrimary) return barcode;

  await db.productBarcode.updateMany({ where: { productId, isPrimary: true }, data: { isPrimary: false } });
  const updated = await db.productBarcode.update({ where: { id: barcodeId }, data: { isPrimary: true } });
  await db.product.update({ where: { id: productId }, data: { barcode: barcode.code } });

  await auditBarcodeEvent(db, {
    actorUserId,
    action: "PRODUCT_BARCODE_PRIMARY_SET",
    productId,
    metadataJson: { barcodeId, code: barcode.code },
  });

  return updated;
}

/** Quita un código. Si era el principal, el siguiente más viejo lo reemplaza, o Product.barcode queda en null si no queda ninguno. */
export async function removeBarcode(barcodeId: string, actorUserId: string, db: Db = prisma): Promise<{ newPrimaryCode: string | null }> {
  const barcode = await db.productBarcode.findUnique({ where: { id: barcodeId } });
  if (!barcode) throw new Error("NOT_FOUND");

  await db.productBarcode.delete({ where: { id: barcodeId } });

  let newPrimaryCode: string | null = null;
  if (barcode.isPrimary) {
    const next = await db.productBarcode.findFirst({
      where: { productId: barcode.productId },
      orderBy: { createdAt: "asc" },
    });
    if (next) {
      await db.productBarcode.update({ where: { id: next.id }, data: { isPrimary: true } });
      newPrimaryCode = next.code;
    }
    await db.product.update({ where: { id: barcode.productId }, data: { barcode: newPrimaryCode } });
  }

  await auditBarcodeEvent(db, {
    actorUserId,
    action: "PRODUCT_BARCODE_REMOVED",
    productId: barcode.productId,
    metadataJson: { barcodeId, code: barcode.code, newPrimaryCode },
  });

  return { newPrimaryCode };
}

/**
 * Usado por updateProduct (catalog/service.ts) para el campo único "Código
 * de barras" del formulario general de edición — el camino viejo, de antes
 * de que existiera la ficha de "Códigos" con varios. Compone los primitivos
 * ya validados (removeBarcode/addBarcode/setPrimaryBarcode) en vez de
 * reinventar su chequeo de duplicados en un tercer camino: quita el
 * principal actual (si había uno y es distinto), agrega el nuevo código, y
 * si al agregarlo NO quedó como principal (porque una presentación
 * secundaria ya existente se promovió automáticamente al quitar el viejo)
 * lo fuerza a serlo — este campo siempre es "el" código principal.
 * rawCode null/vacío quita el principal sin poner uno nuevo.
 */
export async function replacePrimaryBarcode(
  productId: string,
  rawCode: string | null | undefined,
  actorUserId: string,
  db: Db = prisma,
): Promise<{ code: string | null }> {
  if (!rawCode || !rawCode.trim()) {
    const currentPrimary = await db.productBarcode.findFirst({ where: { productId, isPrimary: true } });
    if (currentPrimary) await removeBarcode(currentPrimary.id, actorUserId, db);
    return { code: null };
  }

  const code = normalizeScannedCode(rawCode);
  if (!code) throw new Error("VALIDATION_ERROR: el código no puede estar vacío.");

  const currentPrimary = await db.productBarcode.findFirst({ where: { productId, isPrimary: true } });
  if (currentPrimary?.code === code) return { code };

  // Valida ANTES de tocar nada: si el código nuevo ya existe (de otro
  // producto, o como secundario de este mismo), el principal viejo se queda
  // intacto — nunca se quita algo para terminar en un error a medias.
  const existing = await db.productBarcode.findUnique({
    where: { code },
    select: { id: true, productId: true, product: { select: { id: true, name: true, sku: true, isActive: true } } },
  });
  if (existing && existing.productId !== productId) {
    throw new BarcodeAlreadyExistsError(
      `Ya existe un producto con el código "${code}" (${existing.product.name}).`,
      { id: existing.product.id, name: existing.product.name, sku: existing.product.sku, barcode: code, isActive: existing.product.isActive },
    );
  }
  if (existing && existing.productId === productId) {
    // Ya es un código SECUNDARIO de este mismo producto → solo hace falta
    // promoverlo, nada que quitar primero.
    await setPrimaryBarcode(productId, existing.id, actorUserId, db);
    return { code };
  }

  if (currentPrimary) await removeBarcode(currentPrimary.id, actorUserId, db);

  const created = await addBarcode({ productId, rawCode: code, kind: classifyBackfillBarcode(code).kind, actorUserId }, db);
  if (!created.isPrimary) await setPrimaryBarcode(productId, created.id, actorUserId, db);

  return { code: created.code };
}

/**
 * "Este código estaba en el producto equivocado." Bloquea la fila (FOR
 * UPDATE), relee el productId ACTUAL bajo el lock y solo mueve si todavía
 * no está en el destino — un segundo intento (doble click, reintento de
 * red) con el MISMO destino ve que ya llegó y da ALREADY_PROCESSED, en vez
 * de repetir la reasignación de principal silenciosamente.
 */
export async function moveBarcode(barcodeId: string, toProductId: string, actorUserId: string, db: Db = prisma): Promise<{ code: string }> {
  await db.$queryRaw`SELECT id FROM "ProductBarcode" WHERE id = ${barcodeId} FOR UPDATE`;
  const barcode = await db.productBarcode.findUnique({ where: { id: barcodeId } });
  if (!barcode) throw new Error("NOT_FOUND");

  const fromProductId = barcode.productId;
  if (fromProductId === toProductId) throw new Error("ALREADY_PROCESSED");

  const result = await db.productBarcode.updateMany({
    where: { id: barcodeId, productId: fromProductId },
    data: { productId: toProductId, isPrimary: false },
  });
  if (result.count === 0) throw new Error("ALREADY_PROCESSED");

  // El producto ORIGEN, si este código era su principal, necesita re-promover otro (o quedar sin código) — mismo patrón que removeBarcode.
  if (barcode.isPrimary) {
    const next = await db.productBarcode.findFirst({ where: { productId: fromProductId }, orderBy: { createdAt: "asc" } });
    if (next) {
      await db.productBarcode.update({ where: { id: next.id }, data: { isPrimary: true } });
      await db.product.update({ where: { id: fromProductId }, data: { barcode: next.code } });
    } else {
      await db.product.update({ where: { id: fromProductId }, data: { barcode: null } });
    }
  }

  // El producto DESTINO, si no tenía ningún código todavía, recibe este como principal.
  const destinationHasPrimary = await db.productBarcode.findFirst({ where: { productId: toProductId, isPrimary: true }, select: { id: true } });
  if (!destinationHasPrimary) {
    await db.productBarcode.update({ where: { id: barcodeId }, data: { isPrimary: true } });
    await db.product.update({ where: { id: toProductId }, data: { barcode: barcode.code } });
  }

  await auditBarcodeEvent(db, {
    actorUserId,
    action: "PRODUCT_BARCODE_MOVED",
    productId: toProductId,
    metadataJson: { barcodeId, code: barcode.code, fromProductId, toProductId },
  });

  return { code: barcode.code };
}
