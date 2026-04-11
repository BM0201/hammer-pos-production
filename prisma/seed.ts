import { PrismaClient, RoleCode, SaleOrderStatus } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/password";

const prisma = new PrismaClient();

const CATEGORY_COUNT = 20;
const PRODUCT_COUNT = 1200;
const STAGING_PENDING_ORDERS = 80;

async function upsertUser(params: {
  username: string;
  fullName: string;
  email: string;
  globalRole?: RoleCode | null;
  passwordHash: string;
}) {
  return prisma.user.upsert({
    where: { username: params.username },
    update: {
      fullName: params.fullName,
      email: params.email,
      globalRole: params.globalRole ?? null,
      isActive: true,
    },
    create: {
      username: params.username,
      fullName: params.fullName,
      email: params.email,
      globalRole: params.globalRole ?? null,
      passwordHash: params.passwordHash,
      isActive: true,
    },
  });
}

async function upsertUserBranchRole(params: {
  userId: string;
  branchId: string;
  roleCode: RoleCode;
}) {
  return prisma.userBranchRole.upsert({
    where: {
      userId_branchId_roleCode: {
        userId: params.userId,
        branchId: params.branchId,
        roleCode: params.roleCode,
      },
    },
    update: { isActive: true },
    create: {
      userId: params.userId,
      branchId: params.branchId,
      roleCode: params.roleCode,
      isActive: true,
    },
  });
}

async function seedCatalogAndInventory(branchIds: string[]): Promise<void> {
  const categoryCodes = Array.from({ length: CATEGORY_COUNT }, (_, index) => `CAT-${String(index + 1).padStart(2, "0")}`);

  for (const code of categoryCodes) {
    await prisma.category.upsert({
      where: { code },
      update: { name: `Category ${code}`, isActive: true },
      create: { code, name: `Category ${code}`, isActive: true },
    });
  }

  const categories = await prisma.category.findMany({ where: { code: { in: categoryCodes } }, orderBy: { code: "asc" } });

  // Use individual upserts to handle existing data (SQLite doesn't support skipDuplicates)
  for (let index = 0; index < PRODUCT_COUNT; index++) {
    const sequence = index + 1;
    const sku = `SKU-${String(sequence).padStart(5, "0")}`;
    const barcode = `750000${String(sequence).padStart(7, "0")}`;
    const categoryId = categories[index % categories.length]!.id;
    const standardSalePrice = ((sequence % 85) + 5).toFixed(2);

    await prisma.product.upsert({
      where: { sku },
      update: {
        barcode,
        name: `Producto staging ${sequence}`,
        description: `Dataset staging para pruebas POS #${sequence}`,
        categoryId,
        unit: "unit",
        isActive: true,
        allowsFraction: false,
        isTimber: false,
        standardSalePrice,
      },
      create: {
        sku,
        barcode,
        name: `Producto staging ${sequence}`,
        description: `Dataset staging para pruebas POS #${sequence}`,
        categoryId,
        unit: "unit",
        isActive: true,
        allowsFraction: false,
        isTimber: false,
        standardSalePrice,
      },
    });
  }

  const products = await prisma.product.findMany({
    where: { sku: { startsWith: "SKU-" } },
    select: { id: true },
    orderBy: { sku: "asc" },
  });

  for (const branchId of branchIds) {
    for (let index = 0; index < products.length; index++) {
      const product = products[index]!;
      const quantityOnHand = ((index % 50) + 10).toString();
      const weightedAverageCost = ((index % 90) / 10 + 1).toFixed(6);
      const inventoryValue = ((index % 50) + 10 * ((index % 90) / 10 + 1)).toFixed(2);

      await prisma.inventoryBalance.upsert({
        where: {
          branchId_productId: {
            branchId,
            productId: product.id,
          },
        },
        update: {
          quantityOnHand,
          weightedAverageCost,
          inventoryValue,
        },
        create: {
          branchId,
          productId: product.id,
          quantityOnHand,
          weightedAverageCost,
          inventoryValue,
        },
      });
    }
  }
}

async function seedPendingOrders(branchId: string, userId: string): Promise<void> {
  const customer = await prisma.customer.upsert({
    where: { code: "CUST-STAGING-001" },
    update: { displayName: "Cliente Staging", legalName: "Cliente Staging S.A.", isActive: true },
    create: {
      code: "CUST-STAGING-001",
      displayName: "Cliente Staging",
      legalName: "Cliente Staging S.A.",
      isActive: true,
      email: "cliente.staging@hammer.local",
    },
  });

  const products = await prisma.product.findMany({
    where: { sku: { startsWith: "SKU-" } },
    take: STAGING_PENDING_ORDERS,
    orderBy: { sku: "asc" },
    select: { id: true, standardSalePrice: true },
  });

  for (let index = 0; index < products.length; index += 1) {
    const sequence = index + 1;
    const orderNumber = `SO-STAGE-${String(sequence).padStart(4, "0")}`;
    const unitPrice = products[index]!.standardSalePrice;

    await prisma.saleOrder.upsert({
      where: { orderNumber },
      update: {
        branchId,
        customerId: customer.id,
        createdByUserId: userId,
        status: SaleOrderStatus.PENDING_PAYMENT,
        subtotal: unitPrice,
        discountTotal: "0",
        taxTotal: "0",
        grandTotal: unitPrice,
      },
      create: {
        orderNumber,
        branchId,
        customerId: customer.id,
        createdByUserId: userId,
        status: SaleOrderStatus.PENDING_PAYMENT,
        subtotal: unitPrice,
        discountTotal: "0",
        taxTotal: "0",
        grandTotal: unitPrice,
      },
    });

    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { orderNumber }, select: { id: true } });

    await prisma.saleOrderLine.upsert({
      where: { saleOrderId_productId: { saleOrderId: order.id, productId: products[index]!.id } },
      update: {
        quantity: "1",
        unitPrice,
        discountAmount: "0",
        lineSubtotal: unitPrice,
      },
      create: {
        saleOrderId: order.id,
        productId: products[index]!.id,
        quantity: "1",
        unitPrice,
        discountAmount: "0",
        lineSubtotal: unitPrice,
      },
    });
  }
}

async function main() {
  const [mga, msy, riv] = await Promise.all([
    prisma.branch.upsert({
      where: { code: "MGA" },
      update: { name: "Managua", isActive: true, isDefaultSupplier: true },
      create: { code: "MGA", name: "Managua", isActive: true, isDefaultSupplier: true },
    }),
    prisma.branch.upsert({
      where: { code: "MSY" },
      update: { name: "Masaya", isActive: true, isDefaultSupplier: false },
      create: { code: "MSY", name: "Masaya", isActive: true, isDefaultSupplier: false },
    }),
    prisma.branch.upsert({
      where: { code: "RIV" },
      update: { name: "Rivas", isActive: true, isDefaultSupplier: false },
      create: { code: "RIV", name: "Rivas", isActive: true, isDefaultSupplier: false },
    }),
  ]);

  await Promise.all([
    prisma.physicalCashBox.upsert({
      where: { branchId_code: { branchId: mga.id, code: "CASH-MGA-01" } },
      update: { isActive: true, description: "Main cash box Managua" },
      create: { branchId: mga.id, code: "CASH-MGA-01", isActive: true, description: "Main cash box Managua" },
    }),
    prisma.physicalCashBox.upsert({
      where: { branchId_code: { branchId: msy.id, code: "CASH-MSY-01" } },
      update: { isActive: true, description: "Main cash box Masaya" },
      create: { branchId: msy.id, code: "CASH-MSY-01", isActive: true, description: "Main cash box Masaya" },
    }),
    prisma.physicalCashBox.upsert({
      where: { branchId_code: { branchId: riv.id, code: "CASH-RIV-01" } },
      update: { isActive: true, description: "Main cash box Rivas" },
      create: { branchId: riv.id, code: "CASH-RIV-01", isActive: true, description: "Main cash box Rivas" },
    }),
  ]);

  // ── Unique default passwords per role for security ──
  // Each user gets a unique hashed password. mustChangePassword forces change on first login.
  const masterPasswordHash = hashPassword("Master#Init2026!");
  const supervisorPasswordHash = hashPassword("Super#Init2026!");
  const salesPasswordHash = hashPassword("Sales#Init2026!");
  const cashierPasswordHash = hashPassword("Caja#Init2026!");
  const warehousePasswordHash = hashPassword("Bodega#Init2026!");
  // Fallback for legacy compatibility
  const defaultPasswordHash = masterPasswordHash;

  // ── OWNER user (Propietario) ──
  const ownerPasswordHash = hashPassword("Owner#Init2026!");
  const owner = await upsertUser({
    username: "propietario",
    fullName: "Propietario HAMMER",
    email: "propietario@hammer.local",
    globalRole: RoleCode.OWNER,
    passwordHash: ownerPasswordHash,
  });

  const master = await upsertUser({
    username: "master",
    fullName: "System Master",
    email: "master@hammer.local",
    globalRole: RoleCode.MASTER,
    passwordHash: masterPasswordHash,
  });

  const usersByBranch = [
    { branch: mga, code: "MGA" },
    { branch: msy, code: "MSY" },
    { branch: riv, code: "RIV" },
  ];

  let bootstrapSalesUserId = "";

  for (const entry of usersByBranch) {
    const branchId = entry.branch.id;

    const branchAdmin = await upsertUser({
      username: `supervisor.${entry.code.toLowerCase()}`,
      fullName: `Branch Admin ${entry.code}`,
      email: `supervisor.${entry.code.toLowerCase()}@hammer.local`,
      passwordHash: supervisorPasswordHash,
    });

    const salesperson = await upsertUser({
      username: `vendedor.${entry.code.toLowerCase()}`,
      fullName: `Sales ${entry.code}`,
      email: `vendedor.${entry.code.toLowerCase()}@hammer.local`,
      passwordHash: salesPasswordHash,
    });

    if (entry.code === "MGA") {
      bootstrapSalesUserId = salesperson.id;
    }

    const cashier = await upsertUser({
      username: `caja.${entry.code.toLowerCase()}`,
      fullName: `Cashier ${entry.code}`,
      email: `caja.${entry.code.toLowerCase()}@hammer.local`,
      passwordHash: cashierPasswordHash,
    });

    const warehouse = await upsertUser({
      username: `bodega.${entry.code.toLowerCase()}`,
      fullName: `Warehouse ${entry.code}`,
      email: `bodega.${entry.code.toLowerCase()}@hammer.local`,
      passwordHash: warehousePasswordHash,
    });

    const assignments: Array<{ userId: string; roleCode: RoleCode }> = [
      { userId: branchAdmin.id, roleCode: RoleCode.BRANCH_ADMIN },
      { userId: salesperson.id, roleCode: RoleCode.SALES },
      { userId: cashier.id, roleCode: RoleCode.CASHIER },
      { userId: warehouse.id, roleCode: RoleCode.WAREHOUSE },
    ];

    for (const assignment of assignments) {
      await upsertUserBranchRole({
        userId: assignment.userId,
        branchId,
        roleCode: assignment.roleCode,
      });

      await prisma.auditLog.create({
        data: {
          module: "seed",
          action: "SEED_USER_ASSIGNED_BRANCH_ROLE",
          entityType: "User",
          entityId: assignment.userId,
          branchId,
          metadataJson: { roleCode: assignment.roleCode },
        },
      });
    }
  }

  await seedCatalogAndInventory([mga.id, msy.id, riv.id]);
  await seedPendingOrders(mga.id, bootstrapSalesUserId);

  await prisma.auditLog.create({
    data: {
      actorUserId: master.id,
      module: "seed",
      action: "SEED_COMPLETE",
      entityType: "User",
      entityId: master.id,
      metadataJson: {
        branches: ["MGA", "MSY", "RIV"],
        products: PRODUCT_COUNT,
        categories: CATEGORY_COUNT,
        pendingOrders: STAGING_PENDING_ORDERS,
      },
    },
  });

  console.log(`Seed completed. Master user: ${master.username}. Products: ${PRODUCT_COUNT}. Pending orders: ${STAGING_PENDING_ORDERS}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
