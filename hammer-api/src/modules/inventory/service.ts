import { InventoryMovementType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { approvalService } from "@/modules/approvals/service";
import {
  detectExcessiveWacJump,
  detectPackageCostAsUnitCost,
  detectSuspectedPackageCostOnFirstEntry,
  isInboundMovement,
  recalculateWeightedAverage,
  WacValidationError,
} from "@/modules/inventory/wac";
import { APPROVAL_REQUEST_TYPES } from "@/modules/approvals/constants";
import {
  convertBaseQtyToSaleQty,
  convertBaseUnitCostToSaleUnitCost,
  convertSaleQtyToBaseQty,
  convertSaleUnitCostToBaseUnitCost,
  DEFAULT_MINIMUM_CLOSED_PACKAGE_RESERVE,
  formatDualStock,
  calculateSharedStockChange,
  getSharedInventoryBalance,
  resolveInventoryProductForMovement,
} from "@/modules/inventory/unit-conversion";
import { branchProductScopeFilter, excludeDerivedStockGroupMembers, resolveGlobalCostWriteTarget } from "@/modules/catalog/service";
import { checkStockGroupHealth } from "@/modules/catalog/stock-group-health";
import { getProductionReservedBaseQtyTx } from "@/modules/production/reservations";

export const INVENTORY_ADJUSTMENT_APPROVAL_THRESHOLD = 25;

export async function listInventoryBalances(params: { branchId: string; productId?: string }) {
  const resolved = params.productId
    ? await resolveInventoryProductForMovement(prisma, params.productId)
    : null;

  // When listing all balances for a branch (no specific productId), apply the
  // branch-scope filter so that products with zero stock and no history/assignment
  // are excluded from the operational inventory view. Además, se excluyen los
  // miembros DERIVADOS de una fusión (su stock vive en el canónico y su balance
  // propio está en cero) para evitar mostrarlos como stock independiente / doble conteo.
  const scopeFilter: Prisma.InventoryBalanceWhereInput = params.productId
    ? {}
    : {
        AND: [
          {
            OR: [
              { quantityOnHand: { gt: 0 } },
              { product: branchProductScopeFilter(params.branchId) },
            ],
          },
          { product: excludeDerivedStockGroupMembers() },
        ],
      };

  const balances = await prisma.inventoryBalance.findMany({
    where: {
      branchId: params.branchId,
      ...(params.productId ? { productId: resolved?.inventoryProductId ?? params.productId } : {}),
      ...scopeFilter,
    },
    include: { product: true, branch: true },
    orderBy: { product: { name: "asc" } },
  });

  if (!params.productId || !resolved?.conversion) return balances;

  return balances.map((balance) => {
    const sharedStock = formatDualStock({
      baseQuantity: balance.quantityOnHand,
      conversionFactor: resolved.conversion!.conversionFactor,
      packageConversionFactor: resolved.conversion!.conversionFactorToBase,
      baseUnit: resolved.conversion!.baseUnit,
      saleUnit: resolved.conversion!.saleUnit,
      closedPackageQuantity: balance.closedPackageQuantity,
      looseUnitQuantity: balance.looseUnitQuantity,
      packageUnit: resolved.conversion!.packageUnit,
      tracksPackages: resolved.conversion!.tracksPackages,
      minimumClosedPackageReserve: resolved.conversion!.minimumClosedPackageReserve,
      autoOpenForUnitSale: resolved.conversion!.autoOpenForUnitSale,
    });

    return {
      ...balance,
      availableBaseStock: sharedStock.baseQuantity,
      availableSaleStock: sharedStock.saleQuantity,
      baseUnit: sharedStock.baseUnit,
      saleUnit: sharedStock.saleUnit,
      sharedStock,
    };
  });
}

export type InventoryMovementPaginationParams = {
  page?: number;
  limit?: number;
  branchId?: string;
  productId?: string;
  movementType?: InventoryMovementType;
  dateFrom?: string | Date;
  dateTo?: string | Date;
  search?: string;
};

export function clampInventoryMovementPagination(input: { page?: number; limit?: number }) {
  const page = Math.max(1, Math.trunc(input.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 30) || 30));
  return { page, limit, skip: (page - 1) * limit };
}

function endOfDay(date: Date) {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

export async function listInventoryMovementsPaginated(params: InventoryMovementPaginationParams) {
  const resolved = params.productId
    ? await resolveInventoryProductForMovement(prisma, params.productId)
    : null;
  const { page, limit, skip } = clampInventoryMovementPagination(params);
  const dateFrom = params.dateFrom ? new Date(params.dateFrom) : null;
  const dateTo = params.dateTo ? endOfDay(new Date(params.dateTo)) : null;
  const search = params.search?.trim();
  const where: Prisma.InventoryMovementWhereInput = {
    ...(params.branchId ? { branchId: params.branchId } : {}),
    ...(params.productId ? { productId: resolved?.inventoryProductId ?? params.productId } : {}),
    ...(params.movementType ? { movementType: params.movementType } : {}),
    ...((dateFrom || dateTo) ? {
      createdAt: {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      },
    } : {}),
    ...(search ? {
      OR: [
        { referenceType: { contains: search, mode: "insensitive" } },
        { referenceId: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
        { product: { sku: { contains: search, mode: "insensitive" } } },
        { product: { name: { contains: search, mode: "insensitive" } } },
        { branch: { code: { contains: search, mode: "insensitive" } } },
        { branch: { name: { contains: search, mode: "insensitive" } } },
      ],
    } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        movementType: true,
        quantity: true,
        unitCost: true,
        referenceType: true,
        referenceId: true,
        notes: true,
        reason: true,
        inputUnit: true,
        inputQuantity: true,
        baseUnit: true,
        userId: true,
        product: { select: { id: true, sku: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.inventoryMovement.count({ where }),
  ]);

  const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];
  const userMap = userIds.length > 0
    ? new Map(
        (await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }))
          .map((u) => [u.id, u.fullName])
      )
    : new Map<string, string>();

  return {
    rows: rows.map((r) => ({
      ...r,
      userName: r.userId ? (userMap.get(r.userId) ?? null) : null,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

/**
 * Fusión de Inventario v2, Fase 1.1 — declaración EXPLÍCITA de qué parte de
 * la composición cerrado/suelto mueve un movimiento, en vez de que
 * createInventoryMovementTx la infiera únicamente por tipo de producto.
 *
 *  - PACKAGES: mueve cajas/paquetes cerrados.
 *  - LOOSE: mueve unidades sueltas (falla si no alcanza — usar BASE_AUTO
 *    para permitir apertura automática).
 *  - BASE_AUTO: en base; si faltan sueltas para una salida, abre paquetes
 *    cerrados dentro de la MISMA transacción (respetando la reserva mínima
 *    y autoOpenForUnitSale) antes de aplicar el movimiento principal.
 *  - EXPLICIT: fija el delta exacto de closedPackageQuantity/
 *    looseUnitQuantity (para reversiones y conteos físicos). Con costo 0
 *    (dato legado sin costo registrado) se restaura la cantidad SIN tocar
 *    el WAC — promediar contra costo 0 lo corrompería.
 *
 * Sin `composition`, se infiere como antes de este cambio (compatibilidad):
 * PACKAGES si el producto resuelto es la presentación cerrada, LOOSE si no.
 */
export type MovementComposition =
  | { kind: "PACKAGES" }
  | { kind: "LOOSE" }
  | { kind: "BASE_AUTO" }
  | { kind: "EXPLICIT"; closedDelta: Prisma.Decimal | number; looseDelta: Prisma.Decimal | number };

type InventoryMovementInput = {
  actorUserId: string;
  branchId: string;
  productId: string;
  movementType: InventoryMovementType;
  quantity: number;
  unitCost: number;
  referenceType: string;
  referenceId: string;
  notes?: string | null;
  composition?: MovementComposition;
  /**
   * Autoriza explícitamente un costo por unidad inusualmente alto, saltando
   * el guard SUSPECTED_PACKAGE_COST_AS_UNIT_COST. Úsese sólo cuando el usuario
   * confirma que el costo ingresado es correcto (no es el costo del paquete).
   */
  allowHighUnitCost?: boolean;
  /**
   * Autoriza explícitamente un salto grande del WAC en un solo movimiento,
   * saltando el guard EXCESSIVE_WAC_JUMP. Úsese sólo cuando el usuario
   * confirma que el costo ingresado es correcto (no es una unidad de medida
   * equivocada). Queda registrado en auditoría (WAC_LARGE_JUMP_AUTHORIZED)
   * — un salto grande autorizado es legítimo; uno que nadie pueda rastrear
   * después, no.
   */
  allowLargeWacJump?: boolean;
};

type ConsumeSharedStockForSaleInput = {
  branchId: string;
  productId: string;
  quantity: Prisma.Decimal | number | string;
  unit?: string | null;
  saleOrderId?: string | null;
  paymentId?: string | null;
  userId: string;
  referenceType?: string;
  referenceId?: string;
  notes?: string | null;
};

export type SaleStockAvailability = {
  ok: boolean;
  branchId: string;
  productId: string;
  inventoryProductId: string;
  requestedQuantity: Prisma.Decimal;
  requestedBaseQuantity: Prisma.Decimal;
  availableBaseQuantity: Prisma.Decimal;
  availableSaleQuantity: Prisma.Decimal;
  stockMode: "STANDARD" | "PACKAGE" | "LOOSE_WITH_AUTO_OPEN";
  reason?: string;
  details: {
    closedPackageQuantity?: Prisma.Decimal;
    looseUnitQuantity?: Prisma.Decimal;
    openablePackageQuantity?: Prisma.Decimal;
    openableUnitQuantity?: Prisma.Decimal;
    minimumClosedPackageReserve?: Prisma.Decimal;
    packageUnit?: string | null;
    baseUnit?: string | null;
    conversionFactor?: Prisma.Decimal;
  };
};

export class InventoryStockError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InventoryStockError";
    this.code = code;
  }
}

export async function getSaleStockAvailabilityTx(
  tx: Prisma.TransactionClient,
  input: { branchId: string; productId: string; quantity: Prisma.Decimal | number | string },
): Promise<SaleStockAvailability> {
  const requestedQty = new Prisma.Decimal(input.quantity);
  const shared = await getSharedInventoryBalance(tx, { branchId: input.branchId, productId: input.productId });
  const conversion = shared.conversion;
  const balance = shared.balance;

  if (!conversion?.tracksPackages) {
    const requestedBaseQuantity = conversion
      ? convertSaleQtyToBaseQty({ quantity: requestedQty, conversionFactor: conversion.conversionFactor })
      : requestedQty;
    // Producción v2 Fase 2: lo reservado por lotes PLANNED/IN_PROGRESS no
    // está disponible para venta/traslado — se resta de lo físico. Solo en
    // esta rama (la común para insumos de producción: cemento, arena,
    // colorante — no fusiones con presentación de paquete) para mantener el
    // cambio acotado al caso real; los productos con tracksPackages no son
    // insumos típicos de receta y no se tocan aquí.
    const reservedBaseQuantity = await getProductionReservedBaseQtyTx(tx, { branchId: input.branchId, productId: input.productId });
    const availableBaseQuantity = Prisma.Decimal.max(0, (balance?.quantityOnHand ?? new Prisma.Decimal(0)).sub(reservedBaseQuantity));
    return {
      ok: availableBaseQuantity.gte(requestedBaseQuantity),
      branchId: input.branchId,
      productId: input.productId,
      inventoryProductId: shared.inventoryProductId,
      requestedQuantity: requestedQty,
      requestedBaseQuantity,
      availableBaseQuantity,
      availableSaleQuantity: conversion
        ? convertBaseQtyToSaleQty({ baseQuantity: availableBaseQuantity, conversionFactor: conversion.conversionFactor })
        : availableBaseQuantity,
      stockMode: "STANDARD",
      reason: availableBaseQuantity.gte(requestedBaseQuantity) ? undefined : "INSUFFICIENT_STOCK",
      details: {
        baseUnit: conversion?.baseUnit ?? null,
        conversionFactor: conversion?.conversionFactor,
      },
    };
  }

  const factor = new Prisma.Decimal(conversion.conversionFactorToBase ?? conversion.conversionFactor);
  const closed = balance?.closedPackageQuantity ?? new Prisma.Decimal(0);
  const loose = balance?.looseUnitQuantity ?? new Prisma.Decimal(0);
  const reserve = new Prisma.Decimal(conversion.minimumClosedPackageReserve ?? DEFAULT_MINIMUM_CLOSED_PACKAGE_RESERVE);
  const equivalent = closed.mul(factor).add(loose);

  if (conversion.isPackagePresentation) {
    return {
      ok: closed.gte(requestedQty),
      branchId: input.branchId,
      productId: input.productId,
      inventoryProductId: shared.inventoryProductId,
      requestedQuantity: requestedQty,
      requestedBaseQuantity: requestedQty.mul(factor),
      availableBaseQuantity: equivalent,
      availableSaleQuantity: closed,
      stockMode: "PACKAGE",
      reason: closed.gte(requestedQty) ? undefined : "INSUFFICIENT_CLOSED_PACKAGE_STOCK",
      details: {
        closedPackageQuantity: closed,
        looseUnitQuantity: loose,
        minimumClosedPackageReserve: reserve,
        packageUnit: conversion.packageUnit,
        baseUnit: conversion.baseUnit,
        conversionFactor: factor,
      },
    };
  }

  // Fusión triple: bug real — requestedQty viene en la unidad de venta del
  // producto pedido (ej. LIBRA, factor≈0.4536), pero loose/openableUnits/
  // equivalent están en unidades BASE (ej. KILO). En el modelo dual viejo
  // esto nunca se notaba porque el único no-empaque posible era el
  // canónico (factor=1, base=venta son la misma cosa) — con una
  // presentación suelta alternativa de factor≠1 (Libra, Unidad) comparar
  // sin convertir rechazaba ventas con stock de sobra, o aceptaba ventas
  // sin stock suficiente, según los números. Se compara todo en base.
  const requestedBaseQuantity = convertSaleQtyToBaseQty({ quantity: requestedQty, conversionFactor: conversion.conversionFactor });
  const openablePackages = Prisma.Decimal.max(0, closed.sub(reserve));
  const openableUnits = conversion.autoOpenForUnitSale ? openablePackages.mul(factor) : new Prisma.Decimal(0);
  const availableLooseForSaleBase = loose.add(openableUnits);
  const availableLooseForSale = convertBaseQtyToSaleQty({ baseQuantity: availableLooseForSaleBase, conversionFactor: conversion.conversionFactor });
  return {
    ok: availableLooseForSaleBase.gte(requestedBaseQuantity),
    branchId: input.branchId,
    productId: input.productId,
    inventoryProductId: shared.inventoryProductId,
    requestedQuantity: requestedQty,
    requestedBaseQuantity,
    availableBaseQuantity: equivalent,
    availableSaleQuantity: availableLooseForSale,
    stockMode: "LOOSE_WITH_AUTO_OPEN",
    reason: availableLooseForSaleBase.gte(requestedBaseQuantity) ? undefined : "INSUFFICIENT_LOOSE_AND_RESERVED_PACKAGE_STOCK",
    details: {
      closedPackageQuantity: closed,
      looseUnitQuantity: loose,
      openablePackageQuantity: openablePackages,
      openableUnitQuantity: openableUnits,
      minimumClosedPackageReserve: reserve,
      packageUnit: conversion.packageUnit,
      baseUnit: conversion.baseUnit,
      conversionFactor: factor,
    },
  };
}

type OpenPackageInput = {
  actorUserId: string;
  branchId: string;
  stockGroupId: string;
  packageProductId?: string | null;
  actualUnits?: number | null;
  reason?: string | null;
};

type ClosePackageInput = {
  actorUserId: string;
  branchId: string;
  stockGroupId: string;
  packageProductId?: string | null;
  /** Cuántos empaques (cajas) se arman — entero, ya que un empaque es una unidad física discreta. */
  packagesToClose: number;
  /** Sueltas realmente consumidas para armarlos, si difiere del estimado
   * (factor aproximado — ej. el peso real varía un poco al pesar). Default:
   * packagesToClose × conversionFactorToBase. */
  actualUnitsConsumed?: number | null;
  reason?: string | null;
};

type ManualAdjustmentInput = {
  actorUserId: string;
  branchId: string;
  productId: string;
  adjustmentType: "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "PHYSICAL_COUNT" | "DAMAGE" | "RETURN" | "OTHER";
  // Opcional únicamente cuando physicalCount aplica (conteo dual, Fase 1.3) —
  // fuera de ese caso sigue siendo obligatoria (validado en runtime abajo).
  quantity?: number;
  unit?: string;
  reason: string;
  notes?: string | null;
  /**
   * Fusión de Inventario v2, Fase 1.3 — conteo físico DUAL para un producto
   * de un grupo con paquetes ("conté 3 cajas cerradas + 10 libras sueltas").
   * Cuando viene y el producto pertenece a un grupo tracksPackages, tiene
   * prioridad sobre `quantity`/`unit` y se aplica con composition EXPLICIT
   * (el delta exacto contra el conteo/composición actual, no una conversión
   * inferida desde una sola cifra).
   */
  physicalCount?: { closedPackageQuantity: number; looseUnitQuantity: number };
};

type OpeningBalanceInput = {
  actorUserId: string;
  branchId: string;
  productId: string;
  quantity: number;
  unit?: string;
  stockMode: "SET_PHYSICAL_STOCK" | "ADD_TO_STOCK" | "ADD_OPENING_STOCK";
  unitCost?: number | null;
  costMode: "SET_WAC" | "SET_BRANCH_COST" | "QUANTITY_ONLY";
  salePrice?: number | null;
  priceMode: "SET_BRANCH_PRICE" | "SET_GLOBAL_PRICE" | "NO_PRICE_CHANGE";
  reason: string;
  notes?: string | null;
  /** Autoriza un salto grande del WAC (Parte B) cuando costMode=SET_WAC. */
  allowLargeWacJump?: boolean;
};

type OpeningBalanceTxOptions = {
  referenceType?: string;
  referenceId?: string;
  auditAction?: string;
  createNoopMovement?: boolean;
  skipLineAudit?: boolean;
  bulkReference?: string;
};

export async function createInventoryMovementTx(
  tx: Prisma.TransactionClient,
  input: InventoryMovementInput,
) {
  const movementQty = new Prisma.Decimal(input.quantity);
  const movementUnitCost = new Prisma.Decimal(input.unitCost);
  const resolved = await resolveInventoryProductForMovement(tx, input.productId);
  const inventoryProductId = resolved.inventoryProductId;
  const tracksPackages = Boolean(resolved.conversion?.tracksPackages);
  const packageFactor = new Prisma.Decimal(
    resolved.conversion?.conversionFactorToBase
      ?? resolved.conversion?.conversionFactor
      ?? 1,
  );

  // composition efectiva: la declara el caller, o se infiere como antes de
  // Fase 1.1 (compatibilidad) cuando no se especifica.
  const composition: MovementComposition = input.composition
    ?? (tracksPackages && resolved.conversion?.isPackagePresentation ? { kind: "PACKAGES" } : { kind: "LOOSE" });

  // Para EXPLICIT, el signo/magnitud del movimiento lo dictan los deltas de
  // composición (closedDelta/looseDelta), no input.quantity/movementType —
  // se derivan aquí para que WAC y las validaciones operen consistentes.
  let baseMovementQty: Prisma.Decimal;
  let inbound: boolean;
  if (composition.kind === "EXPLICIT") {
    const netBaseDelta = new Prisma.Decimal(composition.closedDelta).mul(packageFactor)
      .add(new Prisma.Decimal(composition.looseDelta));
    baseMovementQty = netBaseDelta.abs();
    inbound = netBaseDelta.gte(0);
  } else {
    inbound = isInboundMovement(input.movementType);
    baseMovementQty = resolved.conversion
      ? convertSaleQtyToBaseQty({ quantity: movementQty, conversionFactor: resolved.conversion.conversionFactor })
      : movementQty;
  }
  const baseMovementUnitCost = resolved.conversion
    ? convertSaleUnitCostToBaseUnitCost({ saleUnitCost: movementUnitCost, conversionFactor: resolved.conversion.conversionFactor })
    : movementUnitCost;

  // ── WAC pre-validation (fail fast before touching the DB) ─────────
  if (baseMovementQty.lte(new Prisma.Decimal(0))) {
    throw new WacValidationError("INVALID_MOVEMENT_QUANTITY", "Quantity must be positive.");
  }
  if (baseMovementUnitCost.lt(new Prisma.Decimal(0))) {
    throw new WacValidationError("NEGATIVE_UNIT_COST", "Unit cost cannot be negative.");
  }
  // EXPLICIT con costo 0 es la reversión de una venta cuyo movimiento
  // original no tenía costo registrado (dato legado) — restaura cantidad
  // SIN tocar el WAC (promediar contra costo 0 lo corrompería). Único
  // camino eximido del guard ZERO_COST_INBOUND; cualquier otra composición
  // con costo 0 en una entrada sigue bloqueada como siempre.
  const zeroCostExplicitRestore = composition.kind === "EXPLICIT" && baseMovementUnitCost.eq(0);
  if (inbound && baseMovementUnitCost.eq(new Prisma.Decimal(0)) && !zeroCostExplicitRestore) {
    throw new WacValidationError("ZERO_COST_INBOUND", "Inbound movements require a positive unit cost.");
  }

  // Step 1: Ensure the balance row exists (idempotent upsert via Prisma).
  await tx.inventoryBalance.upsert({
    where: {
      branchId_productId: {
        branchId: input.branchId,
        productId: inventoryProductId,
      },
    },
    create: {
      branchId: input.branchId,
      productId: inventoryProductId,
      quantityOnHand: 0,
      closedPackageQuantity: 0,
      looseUnitQuantity: 0,
      weightedAverageCost: 0,
      inventoryValue: 0,
    },
    update: {},
  });

  // Step 2: Lock balance row to guarantee atomic stock/WAC updates under concurrency.
  await tx.$queryRaw`
    SELECT id
    FROM "InventoryBalance"
    WHERE "branchId" = ${input.branchId}
      AND "productId" = ${inventoryProductId}
    FOR UPDATE
  `;

  // Step 3: Read the current balance row after lock acquisition.
  let balance = await tx.inventoryBalance.findUnique({
    where: {
      branchId_productId: {
        branchId: input.branchId,
        productId: inventoryProductId,
      },
    },
  });

  if (!balance) {
    throw new Error("INVENTORY_BALANCE_NOT_FOUND");
  }

  // ── Guard anti "costo del paquete ingresado como costo unitario" ──────
  // Bloquea la causa raíz del incidente "Finanzas en negativo": un costo
  // por unidad que en realidad es el costo del PAQUETE completo (inflado
  // ~conversionFactor×). Sólo actúa en entradas de productos empacados con
  // un WAC de referencia real; se puede autorizar con allowHighUnitCost.
  detectPackageCostAsUnitCost({
    inbound,
    baseMovementUnitCost,
    existingWac: balance.weightedAverageCost,
    packageFactor,
    allowHighUnitCost: input.allowHighUnitCost,
  });

  // ── Guard anti "costo de paquete", pero para la PRIMERA entrada (Parte D) ──
  // detectPackageCostAsUnitCost no puede actuar sin un WAC de referencia
  // real (existingWac<=2 → relleno o producto recién creado, su propio
  // FLOOR) — ese hueco es justo el de un saldo inicial. Cuando el producto
  // pertenece a un grupo de fusión, se usa el precio de venta del
  // canónico como referencia en su lugar: nadie compra por unidad más
  // caro de lo que vende. Solo se consulta el precio cuando hace falta
  // (no en cada movimiento) para no sumar una query al camino caliente.
  if (inbound && !input.allowHighUnitCost && balance.weightedAverageCost.lte(2) && packageFactor.gte(4) && resolved.conversion) {
    const canonicalProduct = await tx.product.findUnique({
      where: { id: resolved.conversion.canonicalProductId },
      select: { standardSalePrice: true },
    });
    detectSuspectedPackageCostOnFirstEntry({
      inbound,
      hasExistingWacReference: false,
      baseMovementUnitCost,
      canonicalStandardSalePrice: canonicalProduct?.standardSalePrice ?? null,
      packageFactor,
      allowHighUnitCost: input.allowHighUnitCost,
    });
  }

  // ── BASE_AUTO: si faltan sueltas para una salida, abrir paquetes cerrados
  // DENTRO de esta misma transacción antes del movimiento principal.
  // Generaliza la lógica que antes vivía solo en consumeSharedStockForSaleTx.
  const autoOpenMovements: Prisma.InventoryMovementGetPayload<{}>[] = [];
  if (tracksPackages && resolved.conversion && composition.kind === "BASE_AUTO" && !inbound) {
    const reserve = new Prisma.Decimal(resolved.conversion.minimumClosedPackageReserve ?? DEFAULT_MINIMUM_CLOSED_PACKAGE_RESERVE);
    const deficit = baseMovementQty.sub(balance.looseUnitQuantity);
    if (deficit.gt(0)) {
      const maxOpenablePackages = Prisma.Decimal.max(0, balance.closedPackageQuantity.sub(reserve));
      const packagesToOpen = new Prisma.Decimal(Math.ceil(Number(deficit.div(packageFactor))));

      if (!resolved.conversion.autoOpenForUnitSale || packagesToOpen.gt(maxOpenablePackages)) {
        throw new InventoryStockError(
          "INSUFFICIENT_LOOSE_AND_RESERVED_PACKAGE_STOCK",
          "No hay suficientes unidades sueltas y no se puede abrir el ultimo kilo/caja cerrado.",
        );
      }

      const packageMember = await tx.productStockGroupMember.findFirst({
        where: { stockGroupId: resolved.conversion.stockGroupId, isActive: true, isPackagePresentation: true },
        select: { productId: true },
      });

      let closed = balance.closedPackageQuantity;
      let loose = balance.looseUnitQuantity;
      let equivalent = balance.quantityOnHand;
      for (let index = 0; index < Number(packagesToOpen); index += 1) {
        const closedBefore = closed;
        const looseBefore = loose;
        const equivalentBefore = equivalent;
        const closedAfter = closedBefore.sub(1);
        const looseAfter = looseBefore.add(packageFactor);
        const equivalentAfter = closedAfter.mul(packageFactor).add(looseAfter);

        const openMovement = await tx.inventoryMovement.create({
          data: {
            branchId: input.branchId,
            productId: inventoryProductId,
            movementType: "PACKAGE_AUTO_OPENED",
            quantity: new Prisma.Decimal(1),
            unitCost: balance.weightedAverageCost,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            notes: "Apertura automatica para venta unitaria",
            inputProductId: packageMember?.productId ?? input.productId,
            inputQuantity: new Prisma.Decimal(1),
            inputUnit: resolved.conversion.packageUnit,
            packageUnit: resolved.conversion.packageUnit,
            baseUnit: resolved.conversion.baseUnit,
            conversionFactorSnapshot: packageFactor,
            estimatedUnits: packageFactor,
            actualUnits: packageFactor,
            closedPackageBefore: closedBefore,
            closedPackageAfter: closedAfter,
            looseUnitBefore: looseBefore,
            looseUnitAfter: looseAfter,
            equivalentBaseBefore: equivalentBefore,
            equivalentBaseAfter: equivalentAfter,
            reason: "AUTO_OPEN_FOR_UNIT_SALE",
            userId: input.actorUserId,
          },
        });
        autoOpenMovements.push(openMovement);
        closed = closedAfter;
        loose = looseAfter;
        equivalent = equivalentAfter;
      }

      balance = await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: {
          closedPackageQuantity: closed,
          looseUnitQuantity: loose,
          quantityOnHand: equivalent,
          inventoryValue: equivalent.mul(balance.weightedAverageCost),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: input.branchId,
          module: "inventory",
          action: "PACKAGE_AUTO_OPENED",
          entityType: "ProductStockGroup",
          entityId: resolved.conversion.stockGroupId,
          metadataJson: {
            reason: "AUTO_OPEN_FOR_UNIT_SALE",
            branchId: input.branchId,
            stockGroupId: resolved.conversion.stockGroupId,
            packageProductId: packageMember?.productId ?? null,
            looseProductId: resolved.conversion.canonicalProductId,
            packageUnit: resolved.conversion.packageUnit,
            baseUnit: resolved.conversion.baseUnit,
            conversionFactorSnapshot: packageFactor.toString(),
            packagesOpened: packagesToOpen.toString(),
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            userId: input.actorUserId,
            movementIds: autoOpenMovements.map((m) => m.id),
          },
        },
      });
    }
  }

  const next = zeroCostExplicitRestore
    ? {
        newQty: inbound ? balance.quantityOnHand.add(baseMovementQty) : balance.quantityOnHand.sub(baseMovementQty),
        newWac: balance.weightedAverageCost,
      }
    : recalculateWeightedAverage({
        currentQty: balance.quantityOnHand,
        currentWac: balance.weightedAverageCost,
        movementQty: baseMovementQty,
        movementUnitCost: baseMovementUnitCost,
        inbound,
      });

  // ── Tope al salto del WAC en un solo movimiento (Parte B) ──────────────
  // Independiente de qué camino causó el salto (compra, ajuste, saldo
  // inicial): si el WAC resultante se dispara muy por encima del actual,
  // se bloquea salvo autorización explícita (allowLargeWacJump).
  detectExcessiveWacJump({
    currentWac: balance.weightedAverageCost,
    newWac: next.newWac,
    currentQty: balance.quantityOnHand,
    allowLargeWacJump: input.allowLargeWacJump,
  });

  // Para auditoría (B.3): distingue "allowLargeWacJump venía en true pero
  // el salto ni siquiera era grande" de "el override efectivamente evitó
  // el guard" — solo lo segundo se audita como autorización real. Reutiliza
  // el mismo guard puro sin el override, solo para diagnosticar.
  let wacJumpAuthorized = false;
  if (input.allowLargeWacJump) {
    try {
      detectExcessiveWacJump({
        currentWac: balance.weightedAverageCost,
        newWac: next.newWac,
        currentQty: balance.quantityOnHand,
      });
    } catch (error) {
      if (error instanceof WacValidationError && error.code === "EXCESSIVE_WAC_JUMP") {
        wacJumpAuthorized = true;
      } else {
        throw error;
      }
    }
  }

  let closedPackageBefore: Prisma.Decimal | null = null;
  let closedPackageAfter: Prisma.Decimal | null = null;
  let looseUnitBefore: Prisma.Decimal | null = null;
  let looseUnitAfter: Prisma.Decimal | null = null;
  let equivalentBaseBefore: Prisma.Decimal | null = null;
  let equivalentBaseAfter: Prisma.Decimal | null = null;
  let effectiveMovementType = input.movementType;
  let effectiveQuantityOnHand = next.newQty;

  if (tracksPackages && resolved.conversion) {
    closedPackageBefore = balance.closedPackageQuantity;
    looseUnitBefore = balance.looseUnitQuantity;
    equivalentBaseBefore = balance.quantityOnHand;
    closedPackageAfter = closedPackageBefore;
    looseUnitAfter = looseUnitBefore;

    if (composition.kind === "EXPLICIT") {
      const closedDelta = new Prisma.Decimal(composition.closedDelta);
      const looseDelta = new Prisma.Decimal(composition.looseDelta);
      closedPackageAfter = closedPackageBefore.add(closedDelta);
      looseUnitAfter = looseUnitBefore.add(looseDelta);
      if (closedPackageAfter.lt(0)) throw new Error("INSUFFICIENT_CLOSED_PACKAGE_STOCK");
      if (looseUnitAfter.lt(0)) throw new Error("INSUFFICIENT_LOOSE_UNIT_STOCK");
    } else if (composition.kind === "PACKAGES") {
      if (inbound) {
        closedPackageAfter = closedPackageAfter.add(movementQty);
        effectiveMovementType = input.movementType === "PURCHASE_IN" ? "PACKAGE_IN" : input.movementType;
      } else {
        if (closedPackageBefore.lt(movementQty)) {
          throw new Error("INSUFFICIENT_CLOSED_PACKAGE_STOCK");
        }
        closedPackageAfter = closedPackageAfter.sub(movementQty);
        effectiveMovementType = input.movementType === "SALE_OUT" ? "PACKAGE_SALE_OUT" : input.movementType;
      }
    } else {
      // LOOSE, o BASE_AUTO ya resuelto arriba (deficit cubierto con auto-apertura si hacía falta).
      if (inbound) {
        looseUnitAfter = looseUnitAfter.add(baseMovementQty);
        effectiveMovementType = input.movementType === "RETURN_IN" ? "LOOSE_UNIT_RETURN_IN" : input.movementType;
      } else {
        if (looseUnitBefore.lt(baseMovementQty)) {
          throw new Error("INSUFFICIENT_LOOSE_UNIT_STOCK");
        }
        looseUnitAfter = looseUnitAfter.sub(baseMovementQty);
        effectiveMovementType = input.movementType === "SALE_OUT" ? "LOOSE_UNIT_SALE_OUT" : input.movementType;
      }
    }

    equivalentBaseAfter = closedPackageAfter.mul(packageFactor).add(looseUnitAfter);
    effectiveQuantityOnHand = equivalentBaseAfter;
  }

  const movement = await tx.inventoryMovement.create({
    data: {
      branchId: input.branchId,
      productId: inventoryProductId,
      movementType: effectiveMovementType,
      quantity: baseMovementQty,
      unitCost: baseMovementUnitCost,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      notes: input.notes,
      inputProductId: input.productId,
      inputQuantity: movementQty,
      inputUnit: resolved.conversion?.saleUnit ?? null,
      packageUnit: resolved.conversion?.packageUnit ?? null,
      baseUnit: resolved.conversion?.baseUnit ?? null,
      conversionFactorSnapshot: resolved.conversion?.conversionFactor ?? null,
      closedPackageBefore,
      closedPackageAfter,
      looseUnitBefore,
      looseUnitAfter,
      equivalentBaseBefore,
      equivalentBaseAfter,
      reason: input.notes ?? null,
      userId: input.actorUserId,
    },
  });

  const updatedBalance = await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: {
      quantityOnHand: effectiveQuantityOnHand,
      ...(tracksPackages && closedPackageAfter !== null && looseUnitAfter !== null ? {
        closedPackageQuantity: closedPackageAfter,
        looseUnitQuantity: looseUnitAfter,
      } : {}),
      weightedAverageCost: next.newWac,
      inventoryValue: effectiveQuantityOnHand.mul(next.newWac),
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "inventory",
      action: "INVENTORY_MOVEMENT_CREATE",
      entityType: "InventoryMovement",
      entityId: movement.id,
      metadataJson: {
        movementType: input.movementType,
        quantity: input.quantity,
        unitCost: input.unitCost,
        originalProductId: input.productId,
        inventoryProductId,
        composition: composition.kind,
        unitConversion: resolved.conversion ? {
          stockGroupId: resolved.conversion.stockGroupId,
          stockGroupCode: resolved.conversion.stockGroupCode,
          saleUnit: resolved.conversion.saleUnit,
          baseUnit: resolved.conversion.baseUnit,
          saleQuantity: movementQty.toString(),
          baseQuantity: baseMovementQty.toString(),
          conversionFactor: resolved.conversion.conversionFactor.toString(),
          saleUnitCost: movementUnitCost.toString(),
          baseUnitCost: baseMovementUnitCost.toString(),
        } : null,
        balanceQty: updatedBalance.quantityOnHand.toString(),
        balanceWac: updatedBalance.weightedAverageCost.toString(),
      },
    },
  });

  // Auditoría siempre (Parte B.3): un salto grande del WAC autorizado con
  // allowLargeWacJump es legítimo — pero uno que nadie pueda rastrear
  // después, no. Entrada separada de INVENTORY_MOVEMENT_CREATE de arriba
  // para que se pueda buscar/filtrar específicamente por esta acción.
  if (wacJumpAuthorized) {
    const wacBefore = balance.weightedAverageCost;
    const wacAfter = next.newWac;
    const deltaPercent = wacBefore.gt(0) ? wacAfter.sub(wacBefore).div(wacBefore).mul(100) : null;
    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        module: "inventory",
        action: "WAC_LARGE_JUMP_AUTHORIZED",
        entityType: "InventoryMovement",
        entityId: movement.id,
        metadataJson: {
          productId: inventoryProductId,
          originalProductId: input.productId,
          branchId: input.branchId,
          wacBefore: wacBefore.toString(),
          wacAfter: wacAfter.toString(),
          deltaPercent: deltaPercent?.toString() ?? null,
          authorizedBy: input.actorUserId,
          movementId: movement.id,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
        },
      },
    });
  }

  // Fusión de Inventario v2, Fase 1.5 — verificador de salud permanente:
  // chequeo BARATO (solo balances actuales) tras cada movimiento de un grupo
  // con paquetes. Nunca bloquea la operación del usuario — si el chequeo
  // mismo falla, o si detecta un descuadre, solo queda registrado en
  // auditoría con snapshot para que el semáforo de la UI lo muestre.
  if (tracksPackages && resolved.conversion) {
    try {
      const health = await checkStockGroupHealth(tx, { stockGroupId: resolved.conversion.stockGroupId, branchId: input.branchId });
      if (!health.healthy) {
        await tx.auditLog.create({
          data: {
            actorUserId: input.actorUserId,
            branchId: input.branchId,
            module: "inventory",
            action: "STOCK_GROUP_HEALTH_CHECK_FAILED",
            entityType: "ProductStockGroup",
            entityId: resolved.conversion.stockGroupId,
            metadataJson: {
              triggeredByMovementId: movement.id,
              issues: health.issues,
            },
          },
        });
      }
    } catch {
      // El verificador de salud nunca debe tumbar la operación real.
    }
  }

  return { movement, balance: updatedBalance, autoOpenMovements };
}

export async function createInventoryMovement(input: InventoryMovementInput) {
  return prisma.$transaction((tx) => createInventoryMovementTx(tx, input));
}

/**
 * Converts the base-unit WAC (stored on the canonical product) to the sale-unit cost
 * expected by createInventoryMovementTx for a given product's conversion.
 *
 * createInventoryMovementTx receives `unitCost` as sale-unit cost and internally divides
 * by conversionFactor to get the base-unit cost. So when we already have the base WAC
 * we must multiply back by the factor before passing it in.
 *
 * For canonical products (factor=1) and products with no conversion this is a no-op.
 *
 * Exported for unit tests.
 */
export function movementSaleUnitCostFromBaseWac(
  baseWac: Prisma.Decimal | number,
  conversion: { conversionFactor: Prisma.Decimal | number } | null | undefined,
): number {
  const wac = new Prisma.Decimal(baseWac);
  if (!conversion) return Number(wac);
  const factor = new Prisma.Decimal(conversion.conversionFactor);
  if (factor.eq(1)) return Number(wac);
  return Number(wac.mul(factor));
}

export async function consumeSharedStockForSaleTx(
  tx: Prisma.TransactionClient,
  input: ConsumeSharedStockForSaleInput,
) {
  const requestedQty = new Prisma.Decimal(input.quantity);
  if (requestedQty.lte(0)) {
    throw new WacValidationError("INVALID_MOVEMENT_QUANTITY", "Quantity must be positive.");
  }

  const resolved = await resolveInventoryProductForMovement(tx, input.productId);
  const conversion = resolved.conversion;
  const referenceType = input.referenceType ?? "SALE";
  const referenceId = input.referenceId ?? input.saleOrderId ?? input.paymentId ?? `SALE-${Date.now()}`;

  const shared = await getSharedInventoryBalance(tx, { branchId: input.branchId, productId: input.productId });
  const baseWac = shared.balance?.weightedAverageCost ?? new Prisma.Decimal(0);

  // Fusión de Inventario v2, Fase 1.1: consumeSharedStockForSaleTx ya no
  // duplica la lógica de apertura automática de paquetes — la absorbe
  // createInventoryMovementTx vía composition: BASE_AUTO (abre cajas
  // cerradas dentro de la MISMA transacción si faltan sueltas, respetando
  // la reserva mínima y autoOpenForUnitSale; sin cambio para no-tracksPackages
  // ni para venta directa de la presentación cerrada, que ya funcionaban
  // correctamente por inferencia).
  const result = await createInventoryMovementTx(tx, {
    actorUserId: input.userId,
    branchId: input.branchId,
    productId: input.productId,
    movementType: InventoryMovementType.SALE_OUT,
    quantity: Number(requestedQty),
    // baseWac is cost per base unit; createInventoryMovementTx expects sale-unit cost
    // and divides internally by conversionFactor, so we multiply back here.
    unitCost: movementSaleUnitCostFromBaseWac(baseWac, conversion),
    referenceType,
    referenceId,
    notes: input.notes ?? null,
    composition: conversion?.tracksPackages && !conversion.isPackagePresentation
      ? { kind: "BASE_AUTO" }
      : undefined,
  });

  return { movements: [...result.autoOpenMovements, result.movement], balance: result.balance };
}

export async function openStockPackage(input: OpenPackageInput) {
  return prisma.$transaction(async (tx) => {
    const group = await tx.productStockGroup.findUnique({
      where: { id: input.stockGroupId },
      include: {
        products: {
          where: { isActive: true },
          include: { product: { select: { id: true, sku: true, name: true } } },
          orderBy: [{ isCanonical: "desc" }, { conversionFactor: "asc" }],
        },
      },
    });
    if (!group || !group.isActive) throw new Error("NOT_FOUND: Grupo de stock no encontrado.");
    if (!group.tracksPackages || !group.packageUnit || !group.conversionFactorToBase) {
      throw new Error("VALIDATION_ERROR: Este grupo no maneja stock cerrado/suelto.");
    }

    const canonical = group.products.find((member) => member.isCanonical)
      ?? group.products.find((member) => new Prisma.Decimal(member.conversionFactor).eq(1));
    // Fusión triple: sin fallback a "el primer no-canónico" — con 3+ miembros
    // eso agarraría una presentación suelta alternativa (ej. Libra) como si
    // fuera el empaque. La validación de escritura garantiza exactamente un
    // isPackagePresentation por grupo.
    const packageMember = input.packageProductId
      ? group.products.find((member) => member.productId === input.packageProductId)
      : group.products.find((member) => member.isPackagePresentation);
    if (!canonical || !packageMember) {
      throw new Error("VALIDATION_ERROR: El grupo requiere producto base y presentacion cerrada.");
    }

    const estimatedUnits = group.conversionFactorToBase;
    const actualUnits = new Prisma.Decimal(input.actualUnits ?? Number(estimatedUnits));
    if (actualUnits.lte(0)) {
      throw new Error("VALIDATION_ERROR: Las unidades reales deben ser mayores que 0.");
    }

    await tx.inventoryBalance.upsert({
      where: { branchId_productId: { branchId: input.branchId, productId: canonical.productId } },
      create: {
        branchId: input.branchId,
        productId: canonical.productId,
        quantityOnHand: 0,
        closedPackageQuantity: 0,
        looseUnitQuantity: 0,
        weightedAverageCost: 0,
        inventoryValue: 0,
      },
      update: {},
    });
    await tx.$queryRaw`
      SELECT id
      FROM "InventoryBalance"
      WHERE "branchId" = ${input.branchId}
        AND "productId" = ${canonical.productId}
      FOR UPDATE
    `;

    const balance = await tx.inventoryBalance.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: canonical.productId } },
    });
    if (!balance) throw new Error("INVENTORY_BALANCE_NOT_FOUND");
    if (balance.closedPackageQuantity.lt(1)) {
      throw new Error("INSUFFICIENT_CLOSED_PACKAGE_STOCK");
    }

    const closedPackageBefore = balance.closedPackageQuantity;
    const looseUnitBefore = balance.looseUnitQuantity;
    const equivalentBaseBefore = balance.quantityOnHand;
    const closedPackageAfter = closedPackageBefore.sub(1);
    const looseUnitAfter = looseUnitBefore.add(actualUnits);
    const equivalentBaseAfter = closedPackageAfter.mul(estimatedUnits).add(looseUnitAfter);
    const reason = input.reason?.trim() || "Apertura para venta unitaria";

    const movement = await tx.inventoryMovement.create({
      data: {
        branchId: input.branchId,
        productId: canonical.productId,
        movementType: "PACKAGE_OPENED",
        quantity: new Prisma.Decimal(1),
        unitCost: balance.weightedAverageCost,
        referenceType: "PACKAGE_OPENING",
        referenceId: `OPEN-PACKAGE-${Date.now()}`,
        notes: reason,
        inputProductId: packageMember.productId,
        inputQuantity: new Prisma.Decimal(1),
        inputUnit: group.packageUnit,
        packageUnit: group.packageUnit,
        baseUnit: group.baseUnit,
        conversionFactorSnapshot: estimatedUnits,
        estimatedUnits,
        actualUnits,
        closedPackageBefore,
        closedPackageAfter,
        looseUnitBefore,
        looseUnitAfter,
        equivalentBaseBefore,
        equivalentBaseAfter,
        reason,
        userId: input.actorUserId,
      },
    });

    const updatedBalance = await tx.inventoryBalance.update({
      where: { id: balance.id },
      data: {
        closedPackageQuantity: closedPackageAfter,
        looseUnitQuantity: looseUnitAfter,
        quantityOnHand: equivalentBaseAfter,
        inventoryValue: equivalentBaseAfter.mul(balance.weightedAverageCost),
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        module: "inventory",
        action: "PACKAGE_OPENED",
        entityType: "ProductStockGroup",
        entityId: group.id,
        metadataJson: {
          stockGroupId: group.id,
          packageProductId: packageMember.productId,
          canonicalProductId: canonical.productId,
          packageUnit: group.packageUnit,
          baseUnit: group.baseUnit,
          estimatedUnits: estimatedUnits.toString(),
          actualUnits: actualUnits.toString(),
          closedPackageBefore: closedPackageBefore.toString(),
          closedPackageAfter: closedPackageAfter.toString(),
          looseUnitBefore: looseUnitBefore.toString(),
          looseUnitAfter: looseUnitAfter.toString(),
          equivalentBaseBefore: equivalentBaseBefore.toString(),
          equivalentBaseAfter: equivalentBaseAfter.toString(),
          reason,
        },
      },
    });

    // Fusión de Inventario v2, Fase 1.5: openStockPackage no pasa por
    // createInventoryMovementTx (escribe su propio movimiento a mano), así
    // que el hook de salud se llama aquí también. No bloquea la operación.
    try {
      const health = await checkStockGroupHealth(tx, { stockGroupId: group.id, branchId: input.branchId });
      if (!health.healthy) {
        await tx.auditLog.create({
          data: {
            actorUserId: input.actorUserId,
            branchId: input.branchId,
            module: "inventory",
            action: "STOCK_GROUP_HEALTH_CHECK_FAILED",
            entityType: "ProductStockGroup",
            entityId: group.id,
            metadataJson: { triggeredByMovementId: movement.id, issues: health.issues },
          },
        });
      }
    } catch {
      // El verificador de salud nunca debe tumbar la operación real.
    }

    return {
      ok: true,
      movementId: movement.id,
      branchId: input.branchId,
      stockGroupId: group.id,
      packageProductId: packageMember.productId,
      baseProductId: canonical.productId,
      packageUnit: group.packageUnit,
      baseUnit: group.baseUnit,
      estimatedUnits: Number(estimatedUnits),
      actualUnits: Number(actualUnits),
      closedPackageQuantity: Number(updatedBalance.closedPackageQuantity),
      looseUnitQuantity: Number(updatedBalance.looseUnitQuantity),
      equivalentBaseQuantity: Number(updatedBalance.quantityOnHand),
    };
  });
}

/**
 * Reverso de openStockPackage — reempaca sueltas de vuelta a empaque cerrado
 * (ej. juntar libras/kilos sueltos y volver a formar cajas vendibles). Mismo
 * patrón: transacción propia, lock del canónico, movimiento manual propio
 * (no pasa por createInventoryMovementTx), auditoría, y health-check al
 * final que nunca tumba la operación.
 *
 * El WAC (costo por unidad base) NO cambia — reempacar es solo reordenar la
 * MISMA existencia física entre "cerrado" y "suelto", no una compra/venta.
 * Si actualUnitsConsumed difiere del estimado (factor aproximado), el
 * equivalente base sí varía un poco — igual que openStockPackage con
 * actualUnits.
 */
export async function closeStockPackage(input: ClosePackageInput) {
  return prisma.$transaction(async (tx) => {
    const group = await tx.productStockGroup.findUnique({
      where: { id: input.stockGroupId },
      include: {
        products: {
          where: { isActive: true },
          include: { product: { select: { id: true, sku: true, name: true } } },
          orderBy: [{ isCanonical: "desc" }, { conversionFactor: "asc" }],
        },
      },
    });
    if (!group || !group.isActive) throw new Error("NOT_FOUND: Grupo de stock no encontrado.");
    if (!group.tracksPackages || !group.packageUnit || !group.conversionFactorToBase) {
      throw new Error("VALIDATION_ERROR: Este grupo no maneja stock cerrado/suelto.");
    }

    const canonical = group.products.find((member) => member.isCanonical)
      ?? group.products.find((member) => new Prisma.Decimal(member.conversionFactor).eq(1));
    const packageMember = input.packageProductId
      ? group.products.find((member) => member.productId === input.packageProductId)
      : group.products.find((member) => member.isPackagePresentation);
    if (!canonical || !packageMember) {
      throw new Error("VALIDATION_ERROR: El grupo requiere producto base y presentacion cerrada.");
    }

    const packagesToClose = new Prisma.Decimal(input.packagesToClose ?? 0);
    if (!packagesToClose.isInteger() || packagesToClose.lte(0)) {
      throw new Error("VALIDATION_ERROR: La cantidad de empaques a cerrar debe ser un entero mayor que 0.");
    }

    const estimatedFactor = group.conversionFactorToBase;
    const estimatedUnitsConsumed = packagesToClose.mul(estimatedFactor);
    const actualUnitsConsumed = input.actualUnitsConsumed != null
      ? new Prisma.Decimal(input.actualUnitsConsumed)
      : estimatedUnitsConsumed;
    if (actualUnitsConsumed.lte(0)) {
      throw new Error("VALIDATION_ERROR: Las unidades sueltas consumidas deben ser mayores que 0.");
    }

    await tx.inventoryBalance.upsert({
      where: { branchId_productId: { branchId: input.branchId, productId: canonical.productId } },
      create: {
        branchId: input.branchId,
        productId: canonical.productId,
        quantityOnHand: 0,
        closedPackageQuantity: 0,
        looseUnitQuantity: 0,
        weightedAverageCost: 0,
        inventoryValue: 0,
      },
      update: {},
    });
    await tx.$queryRaw`
      SELECT id
      FROM "InventoryBalance"
      WHERE "branchId" = ${input.branchId}
        AND "productId" = ${canonical.productId}
      FOR UPDATE
    `;

    const balance = await tx.inventoryBalance.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: canonical.productId } },
    });
    if (!balance) throw new Error("INVENTORY_BALANCE_NOT_FOUND");
    if (balance.looseUnitQuantity.lt(actualUnitsConsumed)) {
      throw new Error("INSUFFICIENT_LOOSE_STOCK_TO_CLOSE_PACKAGE");
    }

    const closedPackageBefore = balance.closedPackageQuantity;
    const looseUnitBefore = balance.looseUnitQuantity;
    const equivalentBaseBefore = balance.quantityOnHand;
    const closedPackageAfter = closedPackageBefore.add(packagesToClose);
    const looseUnitAfter = looseUnitBefore.sub(actualUnitsConsumed);
    const equivalentBaseAfter = closedPackageAfter.mul(estimatedFactor).add(looseUnitAfter);
    const reason = input.reason?.trim() || "Reempaque de sueltas a empaque cerrado";

    const movement = await tx.inventoryMovement.create({
      data: {
        branchId: input.branchId,
        productId: canonical.productId,
        movementType: "PACKAGE_CLOSED",
        quantity: packagesToClose,
        unitCost: balance.weightedAverageCost,
        referenceType: "PACKAGE_CLOSING",
        referenceId: `CLOSE-PACKAGE-${Date.now()}`,
        notes: reason,
        inputProductId: packageMember.productId,
        inputQuantity: packagesToClose,
        inputUnit: group.packageUnit,
        packageUnit: group.packageUnit,
        baseUnit: group.baseUnit,
        conversionFactorSnapshot: estimatedFactor,
        estimatedUnits: estimatedUnitsConsumed,
        actualUnits: actualUnitsConsumed,
        closedPackageBefore,
        closedPackageAfter,
        looseUnitBefore,
        looseUnitAfter,
        equivalentBaseBefore,
        equivalentBaseAfter,
        reason,
        userId: input.actorUserId,
      },
    });

    const updatedBalance = await tx.inventoryBalance.update({
      where: { id: balance.id },
      data: {
        closedPackageQuantity: closedPackageAfter,
        looseUnitQuantity: looseUnitAfter,
        quantityOnHand: equivalentBaseAfter,
        inventoryValue: equivalentBaseAfter.mul(balance.weightedAverageCost),
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        module: "inventory",
        action: "PACKAGE_CLOSED",
        entityType: "ProductStockGroup",
        entityId: group.id,
        metadataJson: {
          stockGroupId: group.id,
          packageProductId: packageMember.productId,
          canonicalProductId: canonical.productId,
          packageUnit: group.packageUnit,
          baseUnit: group.baseUnit,
          packagesToClose: packagesToClose.toString(),
          estimatedUnitsConsumed: estimatedUnitsConsumed.toString(),
          actualUnitsConsumed: actualUnitsConsumed.toString(),
          closedPackageBefore: closedPackageBefore.toString(),
          closedPackageAfter: closedPackageAfter.toString(),
          looseUnitBefore: looseUnitBefore.toString(),
          looseUnitAfter: looseUnitAfter.toString(),
          equivalentBaseBefore: equivalentBaseBefore.toString(),
          equivalentBaseAfter: equivalentBaseAfter.toString(),
          reason,
        },
      },
    });

    // Ver comentario equivalente en openStockPackage: el health-check nunca tumba la operación real.
    try {
      const health = await checkStockGroupHealth(tx, { stockGroupId: group.id, branchId: input.branchId });
      if (!health.healthy) {
        await tx.auditLog.create({
          data: {
            actorUserId: input.actorUserId,
            branchId: input.branchId,
            module: "inventory",
            action: "STOCK_GROUP_HEALTH_CHECK_FAILED",
            entityType: "ProductStockGroup",
            entityId: group.id,
            metadataJson: { triggeredByMovementId: movement.id, issues: health.issues },
          },
        });
      }
    } catch {
      // El verificador de salud nunca debe tumbar la operación real.
    }

    return {
      ok: true,
      movementId: movement.id,
      branchId: input.branchId,
      stockGroupId: group.id,
      packageProductId: packageMember.productId,
      baseProductId: canonical.productId,
      packageUnit: group.packageUnit,
      baseUnit: group.baseUnit,
      packagesToClose: Number(packagesToClose),
      estimatedUnitsConsumed: Number(estimatedUnitsConsumed),
      actualUnitsConsumed: Number(actualUnitsConsumed),
      closedPackageQuantity: Number(updatedBalance.closedPackageQuantity),
      looseUnitQuantity: Number(updatedBalance.looseUnitQuantity),
      equivalentBaseQuantity: Number(updatedBalance.quantityOnHand),
    };
  });
}

export async function createManualInventoryAdjustment(input: ManualAdjustmentInput) {
  return prisma.$transaction(async (tx) => {
    const shared = await getSharedInventoryBalance(tx, { branchId: input.branchId, productId: input.productId });
    const conversion = shared.conversion;

    // Fusión de Inventario v2, Fase 1.3 — conteo físico DUAL: cuando el
    // producto pertenece a un grupo con paquetes y el caller manda
    // physicalCount, se aplica el delta EXACTO de cajas/sueltas (composition
    // EXPLICIT) en vez de convertir una sola cifra a una unidad — evita que
    // "conté 3 cajas + 10 lb" se interprete mal como "X lb sueltas".
    if (input.adjustmentType === "PHYSICAL_COUNT" && input.physicalCount && conversion?.tracksPackages) {
      const currentClosed = shared.balance?.closedPackageQuantity ?? new Prisma.Decimal(0);
      const currentLoose = shared.balance?.looseUnitQuantity ?? new Prisma.Decimal(0);
      const closedDelta = new Prisma.Decimal(input.physicalCount.closedPackageQuantity).sub(currentClosed);
      const looseDelta = new Prisma.Decimal(input.physicalCount.looseUnitQuantity).sub(currentLoose);

      if (closedDelta.eq(0) && looseDelta.eq(0)) {
        return {
          ok: true,
          skipped: true,
          message: "El conteo coincide con la composición actual.",
          productId: input.productId,
          branchId: input.branchId,
          previousStock: Number(shared.balance?.quantityOnHand ?? 0),
          newStock: Number(shared.balance?.quantityOnHand ?? 0),
          sharedStock: formatDualStock({
            baseQuantity: shared.balance?.quantityOnHand ?? new Prisma.Decimal(0),
            conversionFactor: conversion.conversionFactor,
            baseUnit: conversion.baseUnit,
            saleUnit: conversion.saleUnit,
            closedPackageQuantity: currentClosed,
            looseUnitQuantity: currentLoose,
            packageUnit: conversion.packageUnit,
            tracksPackages: conversion.tracksPackages,
          }),
        };
      }

      const netBaseDelta = closedDelta.mul(new Prisma.Decimal(conversion.conversionFactorToBase ?? conversion.conversionFactor)).add(looseDelta);
      const baseWac = shared.balance?.weightedAverageCost ?? new Prisma.Decimal(0);
      if (netBaseDelta.gt(0) && baseWac.lte(0)) {
        throw new Error("NO_EFFECTIVE_COST_FOR_MANUAL_ADJUSTMENT");
      }

      const movementResult = await createInventoryMovementTx(tx, {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        productId: conversion.canonicalProductId,
        movementType: netBaseDelta.gte(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
        quantity: Number(netBaseDelta.abs()),
        unitCost: Number(baseWac),
        referenceType: "MANUAL_ADJUSTMENT",
        referenceId: `MANUAL-${Date.now()}`,
        notes: `${input.reason}${input.notes ? ` - ${input.notes}` : ""}`,
        composition: { kind: "EXPLICIT", closedDelta, looseDelta },
      });

      await logAuditEvent({
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        module: "inventory",
        action: "MANUAL_INVENTORY_ADJUSTMENT",
        entityType: "Product",
        entityId: input.productId,
        metadataJson: {
          productId: input.productId,
          adjustmentType: input.adjustmentType,
          physicalCount: input.physicalCount,
          closedDelta: closedDelta.toString(),
          looseDelta: looseDelta.toString(),
          reason: input.reason,
          notes: input.notes ?? null,
          previousClosed: currentClosed.toString(),
          previousLoose: currentLoose.toString(),
          stockConversion: {
            stockGroupId: conversion.stockGroupId,
            stockGroupCode: conversion.stockGroupCode,
            baseUnit: conversion.baseUnit,
            packageUnit: conversion.packageUnit,
          },
        },
      });

      return {
        ok: true,
        movementId: movementResult.movement.id,
        productId: input.productId,
        branchId: input.branchId,
        movementType: netBaseDelta.gte(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
        previousStock: Number(shared.balance?.quantityOnHand ?? 0),
        newStock: Number(movementResult.balance.quantityOnHand),
        previousBaseStock: Number(shared.balance?.quantityOnHand ?? 0),
        newBaseStock: Number(movementResult.balance.quantityOnHand),
        sharedStock: formatDualStock({
          baseQuantity: movementResult.balance.quantityOnHand,
          conversionFactor: conversion.conversionFactor,
          baseUnit: conversion.baseUnit,
          saleUnit: conversion.saleUnit,
          closedPackageQuantity: movementResult.balance.closedPackageQuantity,
          looseUnitQuantity: movementResult.balance.looseUnitQuantity,
          packageUnit: conversion.packageUnit,
          tracksPackages: conversion.tracksPackages,
        }),
      };
    }

    if (input.quantity === undefined) {
      throw new Error("VALIDATION_ERROR: La cantidad es obligatoria fuera del conteo físico dual (cajas + sueltas).");
    }
    const selectedUnit = (input.unit ?? conversion?.saleUnit ?? "").toUpperCase();
    const isBaseUnitAdjustment = !!conversion && selectedUnit === conversion.baseUnit.toUpperCase();
    const currentBaseQty = shared.balance?.quantityOnHand ?? new Prisma.Decimal(0);
    const currentSaleQty = conversion
      ? convertBaseQtyToSaleQty({ baseQuantity: currentBaseQty, conversionFactor: conversion.conversionFactor })
      : currentBaseQty;
    const requestedQty = new Prisma.Decimal(input.quantity);
    const requestedBaseQty = conversion && !isBaseUnitAdjustment
      ? convertSaleQtyToBaseQty({ quantity: requestedQty, conversionFactor: conversion.conversionFactor })
      : requestedQty;

    let movementType: InventoryMovementType = "ADJUSTMENT_IN";
    let movementQty = requestedQty;
    let movementProductId = input.productId;

    if (input.adjustmentType === "ADJUSTMENT_OUT" || input.adjustmentType === "DAMAGE") {
      movementType = "ADJUSTMENT_OUT";
    } else if (input.adjustmentType === "RETURN") {
      movementType = "RETURN_IN";
    } else if (input.adjustmentType === "OTHER") {
      movementType = "ADJUSTMENT_IN";
    } else if (input.adjustmentType === "PHYSICAL_COUNT") {
      const desiredBaseQty = requestedBaseQty;
      const deltaBaseQty = desiredBaseQty.minus(currentBaseQty);
      if (deltaBaseQty.eq(0)) {
        return {
          ok: true,
          skipped: true,
          message: "El conteo coincide con el stock actual.",
          productId: input.productId,
          branchId: input.branchId,
          previousStock: Number(currentSaleQty),
          newStock: Number(currentSaleQty),
          sharedStock: conversion ? formatDualStock({
            baseQuantity: currentBaseQty,
            conversionFactor: conversion.conversionFactor,
            baseUnit: conversion.baseUnit,
            saleUnit: conversion.saleUnit,
          }) : null,
        };
      }
      movementType = deltaBaseQty.gt(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT";
      const deltaAbsBaseQty = deltaBaseQty.abs();
      movementQty = conversion && !isBaseUnitAdjustment
        ? convertBaseQtyToSaleQty({ baseQuantity: deltaAbsBaseQty, conversionFactor: conversion.conversionFactor })
        : deltaAbsBaseQty;
    }

    if (isBaseUnitAdjustment && conversion) {
      movementProductId = conversion.canonicalProductId;
      movementQty = input.adjustmentType === "PHYSICAL_COUNT" ? movementQty : requestedBaseQty;
    }

    const outboundBaseQty = movementType === "ADJUSTMENT_OUT"
      ? (isBaseUnitAdjustment ? movementQty : (conversion ? convertSaleQtyToBaseQty({ quantity: movementQty, conversionFactor: conversion.conversionFactor }) : movementQty))
      : new Prisma.Decimal(0);
    if (outboundBaseQty.gt(currentBaseQty)) {
      throw new Error("INSUFFICIENT_STOCK");
    }

    const baseWac = shared.balance?.weightedAverageCost ?? new Prisma.Decimal(0);
    const saleUnitCost = conversion && !isBaseUnitAdjustment
      ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: baseWac, conversionFactor: conversion.conversionFactor })
      : baseWac;
    const unitCost = isBaseUnitAdjustment && conversion
      ? convertSaleUnitCostToBaseUnitCost({ saleUnitCost, conversionFactor: conversion.conversionFactor })
      : saleUnitCost;
    if (isInboundMovement(movementType) && unitCost.lte(0)) {
      throw new Error("NO_EFFECTIVE_COST_FOR_MANUAL_ADJUSTMENT");
    }

    // Fusión de Inventario v2, Fase 1.3: un ajuste de SALIDA sobre el lado
    // suelto de un grupo con paquetes debe recomponer (abrir cajas) en vez
    // de lanzar INSUFFICIENT_LOOSE_UNIT_STOCK apenas faltan sueltas — ese
    // error queda reservado para cuando ni abriendo alcanza (BASE_AUTO ya lo
    // lanza en ese caso). No aplica si el movimiento apunta directo a la
    // presentación cerrada (ahí "falta stock" significa faltan cajas, no
    // sueltas — no tiene sentido "abrir" para completar cajas).
    const targetsLooseSide = Boolean(conversion?.tracksPackages) && movementProductId === conversion?.canonicalProductId;
    const movementResult = await createInventoryMovementTx(tx, {
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      productId: movementProductId,
      movementType,
      quantity: Number(movementQty),
      unitCost: Number(unitCost),
      referenceType: "MANUAL_ADJUSTMENT",
      referenceId: `MANUAL-${Date.now()}`,
      composition: movementType === "ADJUSTMENT_OUT" && targetsLooseSide ? { kind: "BASE_AUTO" } : undefined,
      notes: `${input.reason}${input.notes ? ` - ${input.notes}` : ""}`,
    });

    const newBaseQty = movementResult.balance.quantityOnHand;
    const newSaleQty = conversion
      ? convertBaseQtyToSaleQty({ baseQuantity: newBaseQty, conversionFactor: conversion.conversionFactor })
      : newBaseQty;

    await logAuditEvent({
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "inventory",
      action: "MANUAL_INVENTORY_ADJUSTMENT",
      entityType: "Product",
      entityId: input.productId,
      metadataJson: {
        productId: input.productId,
        movementProductId,
        adjustmentType: input.adjustmentType,
        movementType,
        requestedQuantity: input.quantity,
        requestedUnit: input.unit ?? null,
        movementQuantity: movementQty.toString(),
        reason: input.reason,
        notes: input.notes ?? null,
        previousBaseStock: currentBaseQty.toString(),
        newBaseStock: newBaseQty.toString(),
        stockConversion: conversion ? {
          stockGroupId: conversion.stockGroupId,
          stockGroupCode: conversion.stockGroupCode,
          baseUnit: conversion.baseUnit,
          saleUnit: conversion.saleUnit,
          conversionFactor: conversion.conversionFactor.toString(),
        } : null,
      },
    });

    return {
      ok: true,
      movementId: movementResult.movement.id,
      productId: input.productId,
      branchId: input.branchId,
      movementType,
      previousStock: Number(currentSaleQty),
      newStock: Number(newSaleQty),
      previousBaseStock: Number(currentBaseQty),
      newBaseStock: Number(newBaseQty),
      sharedStock: conversion ? formatDualStock({
        baseQuantity: newBaseQty,
        conversionFactor: conversion.conversionFactor,
        baseUnit: conversion.baseUnit,
        saleUnit: conversion.saleUnit,
      }) : null,
    };
  });
}

export async function createOpeningBalanceTx(
  tx: Prisma.TransactionClient,
  input: OpeningBalanceInput,
  options: OpeningBalanceTxOptions = {},
) {
    const shared = await getSharedInventoryBalance(tx, { branchId: input.branchId, productId: input.productId });
    const conversion = shared.conversion;
    const selectedUnit = (input.unit ?? conversion?.saleUnit ?? "").toUpperCase();
    const isBaseUnit = !!conversion && selectedUnit === conversion.baseUnit.toUpperCase();
    const currentBaseQty = shared.balance?.quantityOnHand ?? new Prisma.Decimal(0);
    const previousBaseWac = shared.balance?.weightedAverageCost ?? new Prisma.Decimal(0);
    const requestedQty = new Prisma.Decimal(input.quantity);
    const movementProductId = isBaseUnit && conversion ? conversion.canonicalProductId : input.productId;
    const stockChange = calculateSharedStockChange({
      currentBaseQuantity: currentBaseQty,
      enteredQuantity: requestedQty,
      conversionFactor: conversion?.conversionFactor ?? 1,
      isBaseUnit,
      mode: input.stockMode,
    });
    const baseQuantity = stockChange.enteredBaseQty;
    const baseDelta = stockChange.deltaBaseQty;
    const movementBaseQty = baseDelta.abs();
    const movementQty = stockChange.movementQuantity;
    const movementType = baseDelta.lt(0) ? "ADJUSTMENT_OUT" : "ADJUSTMENT_IN";

    const [product, existingSetting] = await Promise.all([
      tx.product.findUniqueOrThrow({
        where: { id: input.productId },
        select: { id: true, standardSalePrice: true },
      }),
      tx.branchProductSetting.findUnique({
        where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
        select: { branchCost: true, branchPrice: true },
      }),
    ]);

    const previousSaleUnitWac = conversion
      ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: previousBaseWac, conversionFactor: conversion.conversionFactor })
      : previousBaseWac;
    const previousEffectiveCost = existingSetting?.branchCost ?? (previousSaleUnitWac.gt(0) ? previousSaleUnitWac : null);
    const previousEffectivePrice = existingSetting?.branchPrice ?? product.standardSalePrice;

    let unitCost = previousSaleUnitWac;
    if (input.costMode === "SET_WAC" || input.costMode === "SET_BRANCH_COST") {
      unitCost = new Prisma.Decimal(input.unitCost ?? 0);
    }
    if (input.costMode === "QUANTITY_ONLY" && unitCost.lte(0)) {
      unitCost = new Prisma.Decimal(0);
    }

    const referenceType = options.referenceType ?? "OPENING_BALANCE";
    const referenceId = options.referenceId ?? `OPENING-${Date.now()}`;
    let movementResult: any = null;
    if (baseDelta.eq(0)) {
      const balance = await tx.inventoryBalance.upsert({
        where: { branchId_productId: { branchId: input.branchId, productId: shared.inventoryProductId } },
        create: {
          branchId: input.branchId,
          productId: shared.inventoryProductId,
          quantityOnHand: currentBaseQty,
          weightedAverageCost: previousBaseWac,
          inventoryValue: currentBaseQty.mul(previousBaseWac),
        },
        update: {},
      });
      const movement = options.createNoopMovement === false
        ? null
        : await tx.inventoryMovement.create({
            data: {
              branchId: input.branchId,
              productId: shared.inventoryProductId,
              movementType: "ADJUSTMENT_IN",
              quantity: new Prisma.Decimal(0),
              unitCost: previousBaseWac,
              referenceType,
              referenceId,
              notes: `Sin cambio de stock - ${input.reason}${input.notes ? ` - ${input.notes}` : ""}`,
            },
          });
      movementResult = { movement, balance };
    } else if (input.costMode === "SET_WAC") {
      movementResult = await createInventoryMovementTx(tx, {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        productId: movementProductId,
        movementType,
        quantity: Number(movementQty),
        unitCost: Number(unitCost),
        referenceType,
        referenceId,
        notes: `${input.reason}${input.notes ? ` - ${input.notes}` : ""}`,
        allowLargeWacJump: input.allowLargeWacJump,
      });
    } else {
      const inventoryProductId = shared.inventoryProductId;
      await tx.inventoryBalance.upsert({
        where: { branchId_productId: { branchId: input.branchId, productId: inventoryProductId } },
        create: {
          branchId: input.branchId,
          productId: inventoryProductId,
          quantityOnHand: 0,
          closedPackageQuantity: 0,
          looseUnitQuantity: 0,
          weightedAverageCost: shared.balance?.weightedAverageCost ?? 0,
          inventoryValue: 0,
        },
        update: {},
      });
      await tx.$queryRaw`
        SELECT id
        FROM "InventoryBalance"
        WHERE "branchId" = ${input.branchId}
          AND "productId" = ${inventoryProductId}
        FOR UPDATE
      `;
      const balance = await tx.inventoryBalance.findUnique({
        where: { branchId_productId: { branchId: input.branchId, productId: inventoryProductId } },
      });
      if (!balance) throw new Error("INVENTORY_BALANCE_NOT_FOUND");
      let nextQty = input.stockMode === "SET_PHYSICAL_STOCK"
        ? baseQuantity
        : balance.quantityOnHand.plus(baseQuantity);
      // Auditoría 2026-07-22 (ALTO Catálogo): la primera carga de existencias
      // de un producto/sucursal arranca con weightedAverageCost=0 (upsert de
      // arriba). Si el modo es SET_BRANCH_COST y sí viene un costo explícito,
      // úsalo como WAC inicial en vez de arrastrar el 0 — de lo contrario
      // costMode=SET_BRANCH_COST/QUANTITY_ONLY podían dejar el costo real
      // (el que alimenta COGS/márgenes) en 0 para siempre, saltándose el
      // guard ZERO_COST_INBOUND que sí protege una compra normal.
      const isFirstEverStock = balance.weightedAverageCost.lte(0) && balance.quantityOnHand.lte(0);
      const nextWac = input.costMode === "SET_BRANCH_COST" && isFirstEverStock && unitCost.gt(0)
        ? unitCost
        : balance.weightedAverageCost;
      if (movementType === "ADJUSTMENT_IN" && nextWac.lte(0)) {
        throw new WacValidationError("ZERO_COST_INBOUND", "Inbound movements require a positive unit cost.");
      }
      let closedPackageBefore: Prisma.Decimal | null = null;
      let closedPackageAfter: Prisma.Decimal | null = null;
      let looseUnitBefore: Prisma.Decimal | null = null;
      let looseUnitAfter: Prisma.Decimal | null = null;
      let equivalentBaseBefore: Prisma.Decimal | null = null;
      let equivalentBaseAfter: Prisma.Decimal | null = null;

      if (conversion?.tracksPackages) {
        const factor = new Prisma.Decimal(conversion.conversionFactorToBase ?? conversion.conversionFactor);
        closedPackageBefore = balance.closedPackageQuantity;
        looseUnitBefore = balance.looseUnitQuantity;
        equivalentBaseBefore = balance.quantityOnHand;
        closedPackageAfter = closedPackageBefore;
        looseUnitAfter = looseUnitBefore;

        if (conversion.isPackagePresentation) {
          closedPackageAfter = input.stockMode === "SET_PHYSICAL_STOCK"
            ? requestedQty
            : closedPackageBefore.add(requestedQty);
        } else {
          looseUnitAfter = input.stockMode === "SET_PHYSICAL_STOCK"
            ? baseQuantity
            : looseUnitBefore.add(baseQuantity);
        }

        equivalentBaseAfter = closedPackageAfter.mul(factor).add(looseUnitAfter);
        nextQty = equivalentBaseAfter;
      }

      const movement = await tx.inventoryMovement.create({
        data: {
          branchId: input.branchId,
          productId: inventoryProductId,
          movementType,
          quantity: movementBaseQty,
          unitCost: nextWac,
          referenceType,
          referenceId,
          notes: `${input.reason}${input.notes ? ` - ${input.notes}` : ""}`,
          inputProductId: input.productId,
          inputQuantity: requestedQty,
          inputUnit: input.unit ?? conversion?.saleUnit ?? null,
          packageUnit: conversion?.packageUnit ?? null,
          baseUnit: conversion?.baseUnit ?? null,
          conversionFactorSnapshot: conversion?.conversionFactor ?? null,
          closedPackageBefore,
          closedPackageAfter,
          looseUnitBefore,
          looseUnitAfter,
          equivalentBaseBefore,
          equivalentBaseAfter,
          reason: input.reason,
          userId: input.actorUserId,
        },
      });
      const updatedBalance = await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: {
          quantityOnHand: nextQty,
          ...(conversion?.tracksPackages && closedPackageAfter !== null && looseUnitAfter !== null ? {
            closedPackageQuantity: closedPackageAfter,
            looseUnitQuantity: looseUnitAfter,
          } : {}),
          inventoryValue: nextQty.mul(nextWac),
        },
      });
      movementResult = { movement, balance: updatedBalance };
    }

    if (input.costMode === "SET_BRANCH_COST") {
      // "revisa todo... para evitar bugs" — este upsert escribía siempre
      // sobre input.productId, mientras el stock/WAC de arriba en esta
      // misma función SÍ redirige a shared.inventoryProductId (el
      // canónico) cuando corresponde. Para un miembro DERIVADO de una
      // fusión, resolveEffectivePricing IGNORA su branchCost propio —
      // solo lee el del canónico — así que este costo quedaba guardado
      // en una fila que el motor de precios nunca lee: dato fantasma, sin
      // efecto real, exactamente la clase de bug que esta sesión viene
      // cerrando (piedrín, arena). Mismo redirect que ya usa updateProduct
      // (catalog/service.ts) para globalCost, acá aplicado a branchCost.
      const costTarget = resolveGlobalCostWriteTarget({
        requestedProductId: input.productId,
        enteredCost: unitCost.toNumber(),
        conversion,
      });
      const branchCostForTarget = new Prisma.Decimal(costTarget.costForTarget);
      await tx.branchProductSetting.upsert({
        where: { branchId_productId: { branchId: input.branchId, productId: costTarget.targetProductId } },
        create: {
          branchId: input.branchId,
          productId: costTarget.targetProductId,
          branchCost: branchCostForTarget,
        },
        update: { branchCost: branchCostForTarget },
      });
    }

    const salePrice = input.salePrice === null || input.salePrice === undefined
      ? null
      : new Prisma.Decimal(input.salePrice);
    if (input.priceMode === "SET_BRANCH_PRICE" && salePrice) {
      await tx.branchProductSetting.upsert({
        where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
        create: {
          branchId: input.branchId,
          productId: input.productId,
          branchPrice: salePrice,
        },
        update: { branchPrice: salePrice },
      });
      // Parte B.1 — "ninguna escritura de precio queda sin rastro".
      const previousBranchPrice = existingSetting?.branchPrice ?? null;
      if (previousBranchPrice === null || !previousBranchPrice.eq(salePrice)) {
        await tx.auditLog.create({
          data: {
            actorUserId: input.actorUserId,
            branchId: input.branchId,
            module: "inventory",
            action: "PRODUCT_PRICE_CHANGED",
            entityType: "Product",
            entityId: input.productId,
            metadataJson: {
              productId: input.productId,
              branchId: input.branchId,
              previousPrice: previousBranchPrice === null ? null : Number(previousBranchPrice),
              newPrice: Number(salePrice),
              field: "branchPrice",
              origin: "saldo_inicial",
            },
          },
        });
      }
    }
    if (input.priceMode === "SET_GLOBAL_PRICE" && salePrice) {
      await tx.product.update({
        where: { id: input.productId },
        data: { standardSalePrice: salePrice },
      });
      // Parte B.1 — "ninguna escritura de precio queda sin rastro".
      if (!product.standardSalePrice.eq(salePrice)) {
        await tx.auditLog.create({
          data: {
            actorUserId: input.actorUserId,
            branchId: input.branchId,
            module: "inventory",
            action: "PRODUCT_PRICE_CHANGED",
            entityType: "Product",
            entityId: input.productId,
            metadataJson: {
              productId: input.productId,
              previousPrice: Number(product.standardSalePrice),
              newPrice: Number(salePrice),
              field: "standardSalePrice",
              origin: "saldo_inicial",
            },
          },
        });
      }
    }

    const refreshedSetting = await tx.branchProductSetting.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
      select: { branchCost: true, branchPrice: true },
    });
    const refreshedProduct = input.priceMode === "SET_GLOBAL_PRICE" && salePrice
      ? { standardSalePrice: salePrice }
      : product;
    const newBaseWac = movementResult.balance.weightedAverageCost;
    const newSaleUnitWac = conversion
      ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: newBaseWac, conversionFactor: conversion.conversionFactor })
      : newBaseWac;
    const newEffectiveCost = refreshedSetting?.branchCost ?? (newSaleUnitWac.gt(0) ? newSaleUnitWac : null);
    const newEffectivePrice = refreshedSetting?.branchPrice ?? refreshedProduct.standardSalePrice;

    const newBaseQty = movementResult.balance.quantityOnHand;
    const newSaleQty = conversion
      ? convertBaseQtyToSaleQty({ baseQuantity: newBaseQty, conversionFactor: conversion.conversionFactor })
      : newBaseQty;

    if (!options.skipLineAudit) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: input.branchId,
          module: "inventory",
          action: options.auditAction ?? "OPENING_BALANCE_CREATE",
          entityType: "Product",
          entityId: input.productId,
          metadataJson: {
        productId: input.productId,
        branchId: input.branchId,
        inventoryProductId: shared.inventoryProductId,
        movementId: movementResult.movement?.id ?? null,
        bulkReference: options.bulkReference ?? null,
        oldStock: currentBaseQty.toString(),
        newStock: newBaseQty.toString(),
        quantityBase: baseQuantity.toString(),
        stockMode: input.stockMode,
        adjustmentBaseDelta: baseDelta.toString(),
        quantity: input.quantity,
        unit: input.unit ?? null,
        oldCost: previousEffectiveCost?.toString() ?? null,
        newCost: newEffectiveCost?.toString() ?? null,
        oldWac: previousBaseWac.toString(),
        newWac: newBaseWac.toString(),
        costMode: input.costMode,
        oldPrice: previousEffectivePrice.toString(),
        newPrice: newEffectivePrice.toString(),
        priceMode: input.priceMode,
        salePrice: input.salePrice ?? null,
        reason: input.reason,
        notes: input.notes ?? null,
        stockConversion: conversion ? {
          stockGroupId: conversion.stockGroupId,
          stockGroupCode: conversion.stockGroupCode,
          baseUnit: conversion.baseUnit,
          saleUnit: conversion.saleUnit,
          conversionFactor: conversion.conversionFactor.toString(),
        } : null,
      },
        },
      });
    }

    return {
      ok: true,
      movementId: movementResult.movement?.id ?? null,
      productId: input.productId,
      inventoryProductId: shared.inventoryProductId,
      branchId: input.branchId,
      movementType,
      referenceType,
      referenceId,
      costMode: input.costMode,
      priceMode: input.priceMode,
      previousBaseStock: Number(currentBaseQty),
      newBaseStock: Number(newBaseQty),
      quantityBase: Number(baseQuantity),
      stockMode: input.stockMode,
      adjustmentBaseDelta: Number(baseDelta),
      newStock: Number(newSaleQty),
      oldCost: previousEffectiveCost === null ? null : Number(previousEffectiveCost),
      newCost: newEffectiveCost === null ? null : Number(newEffectiveCost),
      oldPrice: Number(previousEffectivePrice),
      newPrice: Number(newEffectivePrice),
      weightedAverageCost: movementResult.balance.weightedAverageCost.toString(),
      sharedStock: conversion ? formatDualStock({
        baseQuantity: newBaseQty,
        conversionFactor: conversion.conversionFactor,
        baseUnit: conversion.baseUnit,
        saleUnit: conversion.saleUnit,
      }) : null,
      stockConversion: conversion ? {
        stockGroupId: conversion.stockGroupId,
        stockGroupCode: conversion.stockGroupCode,
        baseUnit: conversion.baseUnit,
        saleUnit: conversion.saleUnit,
        conversionFactor: conversion.conversionFactor.toString(),
        saleQuantity: input.quantity,
        baseQuantity: Number(baseQuantity),
      } : null,
    };
}

export async function createOpeningBalance(input: OpeningBalanceInput) {
  return prisma.$transaction((tx) => createOpeningBalanceTx(tx, input, { createNoopMovement: true }));
}

export async function createOpeningBalanceBulk(input: {
  actorUserId: string;
  branchId: string;
  mode: "SET_PHYSICAL_STOCK" | "ADD_OPENING_STOCK";
  reason: string;
  notes?: string | null;
  lines: Array<{
    productId: string;
    quantity: number;
    unit?: string;
    unitCost?: number | null;
    costMode: "SET_WAC" | "SET_BRANCH_COST" | "QUANTITY_ONLY";
    salePrice?: number | null;
    priceMode: "SET_BRANCH_PRICE" | "SET_GLOBAL_PRICE" | "NO_PRICE_CHANGE";
    notes?: string | null;
    allowLargeWacJump?: boolean;
  }>;
}) {
  const batchReference = `OPENING-BULK-${Date.now()}`;
  const lines = [];
  // Each product runs in its own mini-transaction to avoid a single long-lived
  // transaction that causes 504 timeouts on Vercel serverless functions.
  for (let index = 0; index < input.lines.length; index += 1) {
    const line = input.lines[index];
    const result = await prisma.$transaction((tx) =>
      createOpeningBalanceTx(tx, {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        productId: line.productId,
        quantity: line.quantity,
        unit: line.unit,
        stockMode: input.mode,
        unitCost: line.unitCost,
        costMode: line.costMode,
        salePrice: line.salePrice,
        priceMode: line.priceMode,
        reason: input.reason,
        notes: [line.notes, input.notes].filter(Boolean).join(" - ") || null,
        allowLargeWacJump: line.allowLargeWacJump,
      }, {
        referenceType: "OPENING_BALANCE_BULK",
        referenceId: `${batchReference}-${index + 1}`,
        createNoopMovement: false,
        skipLineAudit: true,
        bulkReference: batchReference,
      })
    );
    lines.push(result);
  }

  const processed = lines.filter((line) => line.movementId !== null).length;
  const skipped = lines.length - processed;
  const summary = {
    totalProducts: lines.length,
    totalInventoryValue: lines.reduce((sum, line) => sum + (Number(line.newBaseStock) * Number(line.weightedAverageCost)), 0),
    productsWithoutCost: lines.filter((line) => line.newCost === null || line.newCost <= 0).length,
    productsWithoutPrice: lines.filter((line) => line.newPrice === null || line.newPrice <= 0).length,
    productsBelowCost: lines.filter((line) => line.newCost !== null && line.newPrice < line.newCost).length,
    lowMarginProducts: lines.filter((line) => {
      if (line.newCost === null || line.newPrice <= 0 || line.newPrice < line.newCost) return false;
      const margin = ((line.newPrice - line.newCost) / line.newPrice) * 100;
      return margin < 20;
    }).length,
  };

  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "inventory",
      action: "OPENING_BALANCE_BULK_CREATE",
      entityType: "InventoryMovement",
      entityId: batchReference,
      metadataJson: {
        batchReference,
        mode: input.mode,
        reason: input.reason,
        notes: input.notes ?? null,
        lineCount: input.lines.length,
        processed,
        skipped,
        productIds: input.lines.map((line) => line.productId),
        summary,
        changes: lines.map((line) => ({
          productId: line.productId,
          inventoryProductId: line.inventoryProductId,
          movementId: line.movementId,
          previousBaseStock: line.previousBaseStock,
          newBaseStock: line.newBaseStock,
          adjustmentBaseDelta: line.adjustmentBaseDelta,
          movementType: line.movementType,
          stockConversion: line.stockConversion,
        })),
      },
    },
  });

  return {
    ok: true,
    batchReference,
    processed,
    skipped,
    summary,
    lines,
  };
}

// Decide qué movimiento ejecutar para llevar el stock de currentQuantity a
// desiredQuantity. Reutilizada tanto por el ajuste directo (bajo umbral) como
// por la ejecución de un STOCK_ADJUSTMENT aprobado (C2) — antes esa segunda
// ruta no existía y aprobar la solicitud no cambiaba el stock.
export function resolveStockAdjustmentMovement(
  desiredQuantity: number,
  currentQuantity: number,
): { movementType: "ADJUSTMENT_IN" | "ADJUSTMENT_OUT"; quantity: number } | null {
  const delta = desiredQuantity - currentQuantity;
  if (Math.abs(delta) <= 1e-9) return null;
  return { movementType: delta > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", quantity: Math.abs(delta) };
}

export async function requestStockAdjustment(input: {
  actorUserId: string;
  branchId: string;
  productId: string;
  desiredQuantity: number;
  reason: string;
  currentQuantity?: number;
  adjustmentDelta?: number;
}) {
  const result = await approvalService.createRequest({
    branchId: input.branchId,
    requestedByUserId: input.actorUserId,
    referenceType: "STOCK_ADJUSTMENT",
    referenceId: input.productId,
    reason: input.reason,
    type: APPROVAL_REQUEST_TYPES.STOCK_ADJUSTMENT,
    payloadJson: {
      desiredQuantity: input.desiredQuantity,
      currentQuantity: input.currentQuantity,
      adjustmentDelta: input.adjustmentDelta,
    },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "inventory",
    action: "STOCK_ADJUSTMENT_REQUESTED",
    entityType: "ApprovalRequest",
    entityId: result.requestId,
    metadataJson: {
      productId: input.productId,
      desiredQuantity: input.desiredQuantity,
      currentQuantity: input.currentQuantity,
      adjustmentDelta: input.adjustmentDelta,
      reason: input.reason,
      approvalStatus: "REQUESTED",
    },
  });

  return {
    status: "REQUESTED",
    requestId: result.requestId,
    message: "Solicitud enviada.",
    created: result.created,
  } as const;
}
