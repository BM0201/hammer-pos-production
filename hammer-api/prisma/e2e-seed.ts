import { PrismaClient, RoleCode } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "../src/modules/auth/password";

const prisma = new PrismaClient();

const MASTER_USERNAME = process.env.E2E_MASTER_USERNAME ?? "e2e_master";
const CASHIER_USERNAME = process.env.E2E_CASHIER_USERNAME ?? "e2e_cashier";
const PASSWORD = process.env.E2E_PASSWORD ?? "E2eHammer1234!";
const BRANCH_CODE = process.env.E2E_BRANCH_CODE ?? "E2E-MGA";
const CASH_BOX_CODE = process.env.E2E_CASH_BOX_CODE ?? "E2E-CASH-01";
const CATEGORY_CODE = process.env.E2E_CATEGORY_CODE ?? "E2E-CAT";
const PRODUCT_SKU = process.env.E2E_PRODUCT_SKU ?? "E2E-PROD-001";

async function cleanupBranch(branchId: string, productId?: string) {
  await prisma.payment.deleteMany({
    where: {
      OR: [
        { saleOrder: { branchId } },
        { cashSession: { physicalCashBox: { branchId } } },
      ],
    },
  });
  await prisma.dispatchTicket.deleteMany({ where: { branchId } });
  await prisma.saleOrderLine.deleteMany({ where: { saleOrder: { branchId } } });
  await prisma.saleOrder.deleteMany({ where: { branchId } });
  await prisma.cashSession.deleteMany({ where: { physicalCashBox: { branchId } } });
  await prisma.operationalDay.deleteMany({ where: { branchId } });
  await prisma.inventoryMovement.deleteMany({ where: { branchId } });
  await prisma.inventoryBalance.deleteMany({ where: { branchId } });
  await prisma.branchProductSetting.deleteMany({ where: { branchId } });
  await prisma.brainDecisionOutcome.deleteMany({ where: { decision: { branchId } } });
  await prisma.brainDecisionActionLog.deleteMany({ where: { decision: { branchId } } });
  await prisma.brainDecision.deleteMany({ where: { branchId } });
  if (productId) {
    await prisma.inventoryImportLine.updateMany({
      where: { updatedProductId: productId },
      data: { updatedProductId: null },
    });
  }
}

async function main() {
  const passwordHash = hashPassword(PASSWORD);

  const branch = await prisma.branch.upsert({
    where: { code: BRANCH_CODE },
    update: { name: "E2E Managua", isActive: true },
    create: { code: BRANCH_CODE, name: "E2E Managua", isActive: true },
  });

  const category = await prisma.category.upsert({
    where: { code: CATEGORY_CODE },
    update: { name: "E2E Categoria", isActive: true },
    create: { code: CATEGORY_CODE, name: "E2E Categoria", isActive: true },
  });

  const product = await prisma.product.upsert({
    where: { sku: PRODUCT_SKU },
    update: {
      name: "E2E Producto operativo",
      categoryId: category.id,
      unit: "UN",
      isActive: true,
      standardSalePrice: 25,
    },
    create: {
      sku: PRODUCT_SKU,
      name: "E2E Producto operativo",
      categoryId: category.id,
      unit: "UN",
      isActive: true,
      standardSalePrice: 25,
    },
  });

  await cleanupBranch(branch.id, product.id);

  const cashBox = await prisma.physicalCashBox.upsert({
    where: { branchId_code: { branchId: branch.id, code: CASH_BOX_CODE } },
    update: { description: "Caja E2E", isActive: true },
    create: { branchId: branch.id, code: CASH_BOX_CODE, description: "Caja E2E", isActive: true },
  });

  await prisma.branchModuleConfig.upsert({
    where: { branchId: branch.id },
    update: { enableCashier: true, enableDispatch: false },
    create: { branchId: branch.id, enableCashier: true, enableDispatch: false },
  });

  await prisma.inventoryBalance.upsert({
    where: { branchId_productId: { branchId: branch.id, productId: product.id } },
    update: { quantityOnHand: 100, weightedAverageCost: 10, inventoryValue: 1000 },
    create: { branchId: branch.id, productId: product.id, quantityOnHand: 100, weightedAverageCost: 10, inventoryValue: 1000 },
  });

  const master = await prisma.user.upsert({
    where: { username: MASTER_USERNAME },
    update: {
      email: "e2e.master@hammer.local",
      fullName: "E2E Master",
      globalRole: RoleCode.MASTER,
      isActive: true,
      mustChangePassword: false,
      passwordHash,
    },
    create: {
      username: MASTER_USERNAME,
      email: "e2e.master@hammer.local",
      fullName: "E2E Master",
      globalRole: RoleCode.MASTER,
      isActive: true,
      mustChangePassword: false,
      passwordHash,
    },
  });

  const cashier = await prisma.user.upsert({
    where: { username: CASHIER_USERNAME },
    update: {
      email: "e2e.cashier@hammer.local",
      fullName: "E2E Cajero",
      globalRole: null,
      isActive: true,
      mustChangePassword: false,
      passwordHash,
    },
    create: {
      username: CASHIER_USERNAME,
      email: "e2e.cashier@hammer.local",
      fullName: "E2E Cajero",
      isActive: true,
      mustChangePassword: false,
      passwordHash,
    },
  });

  for (const roleCode of [RoleCode.CASHIER, RoleCode.SALES]) {
    await prisma.userBranchRole.upsert({
      where: { userId_branchId_roleCode: { userId: cashier.id, branchId: branch.id, roleCode } },
      update: { isActive: true },
      create: { userId: cashier.id, branchId: branch.id, roleCode, isActive: true },
    });
  }

  const oldBatchIds = await prisma.inventoryImportBatch.findMany({
    where: { createdByUserId: master.id },
    select: { id: true },
  });
  if (oldBatchIds.length) {
    await prisma.inventoryImportLine.deleteMany({ where: { batchId: { in: oldBatchIds.map((batch) => batch.id) } } });
    await prisma.inventoryImportBatch.deleteMany({ where: { id: { in: oldBatchIds.map((batch) => batch.id) } } });
  }
  await prisma.branchProductSetting.deleteMany({ where: { product: { sku: { startsWith: "E2E-IMPORT-" } } } });
  await prisma.inventoryBalance.deleteMany({ where: { product: { sku: { startsWith: "E2E-IMPORT-" } } } });
  await prisma.inventoryMovement.deleteMany({ where: { product: { sku: { startsWith: "E2E-IMPORT-" } } } });
  await prisma.product.deleteMany({ where: { sku: { startsWith: "E2E-IMPORT-" } } });

  const state = {
    baseURL: process.env.E2E_API_URL ?? "http://127.0.0.1:4000",
    credentials: {
      master: { username: MASTER_USERNAME, password: PASSWORD },
      cashier: { username: CASHIER_USERNAME, password: PASSWORD },
    },
    branch: { id: branch.id, code: branch.code, name: branch.name },
    cashBox: { id: cashBox.id, code: cashBox.code },
    category: { id: category.id, code: category.code },
    product: { id: product.id, sku: product.sku, price: 25 },
  };

  const statePath = path.resolve(process.cwd(), "../hammer-frontend/tests/e2e/.e2e-state.json");
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  console.log(`E2E seed listo: ${BRANCH_CODE}`);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
