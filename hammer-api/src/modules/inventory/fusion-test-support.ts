import { Prisma } from "@prisma/client";

/**
 * Fake Prisma tx en memoria para probar createInventoryMovementTx (y lo que
 * internamente consulta: resolveInventoryProductForMovement/
 * getProductStockConversion/getSharedInventoryBalance) sin base de datos real.
 * Implementa solo los métodos que esas funciones realmente llaman — mismo
 * patrón que global-cost-update.test.ts / expense-summary-vigency.test.ts.
 *
 * Modela UN grupo de fusión con dos miembros (canónico "suelto" + derivado
 * "paquete"), UNA sucursal, y sus balances/movimientos en memoria mutable.
 */
export type FusionWorldConfig = {
  branchId: string;
  stockGroupId: string;
  tracksPackages: boolean;
  packageUnit: string | null;
  baseUnit: string;
  conversionFactorToBase: number | null;
  minimumClosedPackageReserve: number;
  autoOpenForUnitSale: boolean;
  canonicalProductId: string;
  packageProductId: string | null;
  packageConversionFactor: number | null;
  initialCanonicalBalance: {
    quantityOnHand: number;
    closedPackageQuantity: number;
    looseUnitQuantity: number;
    weightedAverageCost: number;
  };
};

export function createFusionFakeTx(config: FusionWorldConfig) {
  const balances = new Map<string, {
    id: string;
    branchId: string;
    productId: string;
    quantityOnHand: Prisma.Decimal;
    closedPackageQuantity: Prisma.Decimal;
    looseUnitQuantity: Prisma.Decimal;
    weightedAverageCost: Prisma.Decimal;
    inventoryValue: Prisma.Decimal;
  }>();
  const key = (branchId: string, productId: string) => `${branchId}:${productId}`;

  balances.set(key(config.branchId, config.canonicalProductId), {
    id: `bal-${config.canonicalProductId}`,
    branchId: config.branchId,
    productId: config.canonicalProductId,
    quantityOnHand: new Prisma.Decimal(config.initialCanonicalBalance.quantityOnHand),
    closedPackageQuantity: new Prisma.Decimal(config.initialCanonicalBalance.closedPackageQuantity),
    looseUnitQuantity: new Prisma.Decimal(config.initialCanonicalBalance.looseUnitQuantity),
    weightedAverageCost: new Prisma.Decimal(config.initialCanonicalBalance.weightedAverageCost),
    inventoryValue: new Prisma.Decimal(config.initialCanonicalBalance.quantityOnHand).mul(config.initialCanonicalBalance.weightedAverageCost),
  });

  const movements: Array<Record<string, unknown> & { id: string }> = [];
  const auditLogs: Array<Record<string, unknown>> = [];
  let movementCounter = 0;

  const memberRow = (productId: string) => {
    if (productId === config.canonicalProductId) {
      return {
        id: `member-${productId}`,
        stockGroupId: config.stockGroupId,
        productId,
        saleUnit: config.baseUnit,
        conversionFactor: new Prisma.Decimal(1),
        isCanonical: true,
        isPackagePresentation: false,
        isActive: true,
      };
    }
    if (config.packageProductId && productId === config.packageProductId) {
      return {
        id: `member-${productId}`,
        stockGroupId: config.stockGroupId,
        productId,
        saleUnit: config.packageUnit ?? "PAQUETE",
        conversionFactor: new Prisma.Decimal(config.packageConversionFactor ?? 1),
        isCanonical: false,
        isPackagePresentation: true,
        isActive: true,
      };
    }
    return null;
  };

  const groupProducts = [config.canonicalProductId, config.packageProductId]
    .filter((id): id is string => id !== null)
    .map((id) => memberRow(id)!)
    .sort((a, b) => (b.isCanonical ? 1 : 0) - (a.isCanonical ? 1 : 0) || Number(a.conversionFactor) - Number(b.conversionFactor));

  const tx = {
    productStockGroupMember: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        const where = args.where as { productId?: string; stockGroupId?: string; isActive?: boolean; isPackagePresentation?: boolean };
        if (where.stockGroupId && where.isPackagePresentation) {
          // Búsqueda del miembro-paquete del grupo (usada por BASE_AUTO / auto-apertura).
          const pkg = groupProducts.find((m) => m.isPackagePresentation);
          return pkg ?? null;
        }
        const productId = where.productId;
        if (!productId) return null;
        const member = memberRow(productId);
        if (!member) return null;
        return {
          ...member,
          stockGroup: {
            id: config.stockGroupId,
            code: "TEST_GROUP",
            name: "Grupo de prueba",
            baseUnit: config.baseUnit,
            packageUnit: config.packageUnit,
            conversionFactorToBase: config.conversionFactorToBase === null ? null : new Prisma.Decimal(config.conversionFactorToBase),
            tracksPackages: config.tracksPackages,
            approximateFactor: false,
            minimumClosedPackageReserve: new Prisma.Decimal(config.minimumClosedPackageReserve),
            autoOpenForUnitSale: config.autoOpenForUnitSale,
            isActive: true,
            products: groupProducts,
          },
        };
      },
    },
    inventoryBalance: {
      upsert: async (args: { where: { branchId_productId: { branchId: string; productId: string } }; create: Record<string, unknown> }) => {
        const k = key(args.where.branchId_productId.branchId, args.where.branchId_productId.productId);
        if (!balances.has(k)) {
          balances.set(k, {
            id: `bal-${args.where.branchId_productId.productId}`,
            branchId: args.where.branchId_productId.branchId,
            productId: args.where.branchId_productId.productId,
            quantityOnHand: new Prisma.Decimal(0),
            closedPackageQuantity: new Prisma.Decimal(0),
            looseUnitQuantity: new Prisma.Decimal(0),
            weightedAverageCost: new Prisma.Decimal(0),
            inventoryValue: new Prisma.Decimal(0),
          });
        }
        return balances.get(k)!;
      },
      findUnique: async (args: { where: { branchId_productId: { branchId: string; productId: string } } }) => {
        return balances.get(key(args.where.branchId_productId.branchId, args.where.branchId_productId.productId)) ?? null;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const entry = [...balances.values()].find((b) => b.id === args.where.id);
        if (!entry) throw new Error(`balance ${args.where.id} no encontrado en fake db`);
        Object.assign(entry, args.data);
        return { ...entry };
      },
    },
    inventoryMovement: {
      create: async (args: { data: Record<string, unknown> }) => {
        movementCounter += 1;
        const row = { id: `mv-${movementCounter}`, ...args.data };
        movements.push(row);
        return row;
      },
      findMany: async (args: { where: Record<string, unknown> }) => {
        const where = args.where as { referenceId?: string; movementType?: string | { in: string[] } };
        return movements.filter((m) => {
          if (where.referenceId && m.referenceId !== where.referenceId) return false;
          if (where.movementType) {
            if (typeof where.movementType === "string") {
              if (m.movementType !== where.movementType) return false;
            } else if (!where.movementType.in.includes(m.movementType as string)) {
              return false;
            }
          }
          return true;
        });
      },
      count: async (args: { where: Record<string, unknown> }) => {
        const where = args.where as { referenceId?: string; movementType?: string; referenceType?: string };
        return movements.filter((m) =>
          (!where.referenceId || m.referenceId === where.referenceId)
          && (!where.movementType || m.movementType === where.movementType)
          && (!where.referenceType || m.referenceType === where.referenceType)
        ).length;
      },
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        auditLogs.push(args.data);
        return args.data;
      },
    },
    $queryRaw: async () => [],
  };

  return {
    tx: tx as unknown as Prisma.TransactionClient,
    getBalance: () => balances.get(key(config.branchId, config.canonicalProductId))!,
    movements,
    auditLogs,
  };
}
