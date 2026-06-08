/**
 * seed.ts — Development / local seed  [V2 — POS/Cashier/Payments + Iron module]
 *
 * Idempotent: safe to run multiple times without duplicating data.
 *
 * Creates:
 *   1. Branch "Managua Central" (MGA) + MASTER user (kept from V1).
 *   2. Branch "Masaya Central" (MSY) configured in HYBRID payment workflow.
 *   3. Physical cash box "Caja Principal Masaya".
 *   4. Category "Hierro" (iron) — physical category for quintal/varilla products.
 *   5. Iron products: HIERRO 3/8, 1/2, 1/4 (quintal) + VARILLA HIERRO 3/8, 1/2, 1/4.
 *   6. Iron stock groups (shared stock) linking varilla (canonical) <-> quintal.
 *   7. Test users: vendedor (SALES), cajero (CASHIER),
 *      vendedor-cajero (SALES + CASHIER), admin (BRANCH_ADMIN).
 *
 * Run with:  npm run seed        (alias of `tsx prisma/seed.ts`)
 *        or:  npx prisma db seed
 */

import { Prisma, PrismaClient, RoleCode } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/password";

const prisma = new PrismaClient();

// ── Defaults (can be overridden via env) ──────────────────────────────────────
const MASTER_USERNAME = process.env.MASTER_INITIAL_USERNAME ?? "master";
const MASTER_PASSWORD = process.env.MASTER_INITIAL_PASSWORD ?? "ElChele1234!";
const MASTER_EMAIL = "master@hammer.local";
const MASTER_FULLNAME = "System Master";

const MGA_CODE = "MGA";
const MGA_NAME = "Managua Central";

const MSY_CODE = "MSY";
const MSY_NAME = "Masaya Central";

// Default password for all demo operative users.
const DEMO_PASSWORD = process.env.DEMO_USERS_PASSWORD ?? "Hammer1234!";

// Iron sizes -> bars per quintal (must match unit-conversion.ts).
const IRON_SIZES: { label: string; code: string; barsPerQuintal: number; quintalPrice: number; varillaPrice: number }[] = [
  { label: "3/8", code: "HIERRO_3_8", barsPerQuintal: 14, quintalPrice: 3500, varillaPrice: 270 },
  { label: "1/2", code: "HIERRO_1_2", barsPerQuintal: 8, quintalPrice: 3800, varillaPrice: 510 },
  { label: "1/4", code: "HIERRO_1_4", barsPerQuintal: 30, quintalPrice: 3300, varillaPrice: 120 },
];

async function main(): Promise<void> {
  console.log("🔧 Seed (development, V2) — starting …");

  // ── 1. Branch Managua Central + cash box (kept from V1) ─────────────────────
  const mga = await prisma.branch.upsert({
    where: { code: MGA_CODE },
    update: { name: MGA_NAME, isActive: true },
    create: { code: MGA_CODE, name: MGA_NAME, isActive: true, isDefaultSupplier: true },
  });
  await prisma.physicalCashBox.upsert({
    where: { branchId_code: { branchId: mga.id, code: `CASH-${MGA_CODE}-01` } },
    update: { isActive: true, description: "Caja principal" },
    create: { branchId: mga.id, code: `CASH-${MGA_CODE}-01`, description: "Caja principal", isActive: true },
  });
  console.log(`  ✔ Branch "${mga.name}" (${mga.code})`);

  // ── 2. Master user ──────────────────────────────────────────────────────────
  const masterUser = await prisma.user.upsert({
    where: { username: MASTER_USERNAME },
    update: {
      fullName: MASTER_FULLNAME,
      email: MASTER_EMAIL,
      globalRole: RoleCode.MASTER,
      isActive: true,
      ...(process.env.RESET_MASTER_PASSWORD === "true"
        ? { passwordHash: hashPassword(MASTER_PASSWORD), mustChangePassword: true }
        : {}),
    },
    create: {
      username: MASTER_USERNAME,
      fullName: MASTER_FULLNAME,
      email: MASTER_EMAIL,
      globalRole: RoleCode.MASTER,
      passwordHash: hashPassword(MASTER_PASSWORD),
      mustChangePassword: true,
      isActive: true,
    },
  });
  console.log(`  ✔ Master user "${masterUser.username}"`);

  // ── 3. Branch Masaya + HYBRID module config + cash box ──────────────────────
  const msy = await prisma.branch.upsert({
    where: { code: MSY_CODE },
    update: { name: MSY_NAME, isActive: true },
    create: { code: MSY_CODE, name: MSY_NAME, isActive: true },
  });
  console.log(`  ✔ Branch "${msy.name}" (${msy.code})`);

  // [V2] HYBRID: POS may both "Enviar a caja" and "Cobrar aquí" (per user permissions).
  await prisma.branchModuleConfig.upsert({
    where: { branchId: msy.id },
    update: {
      enableCashier: true,
      enableDispatch: true,
      paymentWorkflowMode: "HYBRID",
      dispatchWorkflowMode: "ENABLED",
      requireOpenCashSessionForDirectSale: true,
      allowSellerDirectPayment: true,
      allowCashierQueue: true,
      updatedByUserId: masterUser.id,
    },
    create: {
      branchId: msy.id,
      enableCashier: true,
      enableDispatch: true,
      paymentWorkflowMode: "HYBRID",
      dispatchWorkflowMode: "ENABLED",
      requireOpenCashSessionForDirectSale: true,
      allowSellerDirectPayment: true,
      allowCashierQueue: true,
      updatedByUserId: masterUser.id,
    },
  });
  console.log(`  ✔ BranchModuleConfig (HYBRID) for "${msy.name}"`);

  const masayaCashBox = await prisma.physicalCashBox.upsert({
    where: { branchId_code: { branchId: msy.id, code: `CASH-${MSY_CODE}-01` } },
    update: { isActive: true, description: "Caja Principal Masaya" },
    create: { branchId: msy.id, code: `CASH-${MSY_CODE}-01`, description: "Caja Principal Masaya", isActive: true },
  });
  console.log(`  ✔ Physical cash box "Caja Principal Masaya" (${masayaCashBox.code})`);

  // ── 4. Category "Hierro" ─────────────────────────────────────────────────────
  const hierro = await prisma.category.upsert({
    where: { code: "HIERRO" },
    update: { name: "Hierro", isActive: true },
    create: { code: "HIERRO", name: "Hierro", isActive: true },
  });
  console.log(`  ✔ Category "${hierro.name}" (${hierro.code})`);

  // ── 5 + 6. Iron products + shared stock groups ──────────────────────────────
  for (const size of IRON_SIZES) {
    // QUINTAL product (name MUST start with "HIERRO" for unit-conversion detection)
    const quintal = await prisma.product.upsert({
      where: { sku: `${size.code}_Q` },
      update: { name: `HIERRO ${size.label}`, categoryId: hierro.id, unit: "quintal", standardSalePrice: new Prisma.Decimal(size.quintalPrice), isActive: true },
      create: {
        sku: `${size.code}_Q`,
        name: `HIERRO ${size.label}`,
        categoryId: hierro.id,
        unit: "quintal",
        allowsFraction: false,
        standardSalePrice: new Prisma.Decimal(size.quintalPrice),
        isActive: true,
      },
    });

    // VARILLA product (name MUST start with "VARILLA HIERRO" for detection; canonical/base unit)
    const varilla = await prisma.product.upsert({
      where: { sku: `${size.code}_V` },
      update: { name: `VARILLA HIERRO ${size.label}`, categoryId: hierro.id, unit: "varilla", standardSalePrice: new Prisma.Decimal(size.varillaPrice), isActive: true },
      create: {
        sku: `${size.code}_V`,
        name: `VARILLA HIERRO ${size.label}`,
        categoryId: hierro.id,
        unit: "varilla",
        allowsFraction: false,
        standardSalePrice: new Prisma.Decimal(size.varillaPrice),
        isActive: true,
      },
    });

    // Stock group (baseUnit = VARILLA). Canonical = varilla (factor 1). Quintal = N bars.
    const group = await prisma.productStockGroup.upsert({
      where: { code: size.code },
      update: { name: `Hierro ${size.label} - stock compartido`, baseUnit: "VARILLA", categoryId: hierro.id, isActive: true },
      create: { code: size.code, name: `Hierro ${size.label} - stock compartido`, baseUnit: "VARILLA", categoryId: hierro.id },
    });

    await prisma.productStockGroupMember.upsert({
      where: { stockGroupId_productId: { stockGroupId: group.id, productId: varilla.id } },
      update: { saleUnit: "VARILLA", conversionFactor: new Prisma.Decimal(1), isCanonical: true, isActive: true },
      create: { stockGroupId: group.id, productId: varilla.id, saleUnit: "VARILLA", conversionFactor: new Prisma.Decimal(1), isCanonical: true },
    });
    await prisma.productStockGroupMember.upsert({
      where: { stockGroupId_productId: { stockGroupId: group.id, productId: quintal.id } },
      update: { saleUnit: "QUINTAL", conversionFactor: new Prisma.Decimal(size.barsPerQuintal), isCanonical: false, isActive: true },
      create: { stockGroupId: group.id, productId: quintal.id, saleUnit: "QUINTAL", conversionFactor: new Prisma.Decimal(size.barsPerQuintal), isCanonical: false },
    });

    // Seed shared inventory balance on the canonical (varilla) product for Masaya.
    await prisma.inventoryBalance.upsert({
      where: { branchId_productId: { branchId: msy.id, productId: varilla.id } },
      update: {},
      create: {
        branchId: msy.id,
        productId: varilla.id,
        quantityOnHand: new Prisma.Decimal(size.barsPerQuintal * 5), // ~5 quintales worth of bars
        weightedAverageCost: new Prisma.Decimal(size.varillaPrice).mul(new Prisma.Decimal("0.8")),
        inventoryValue: new Prisma.Decimal(size.barsPerQuintal * 5).mul(new Prisma.Decimal(size.varillaPrice).mul(new Prisma.Decimal("0.8"))),
      },
    });

    console.log(`  ✔ Iron group ${size.code}: HIERRO ${size.label} (quintal=${size.barsPerQuintal} varillas) + VARILLA HIERRO ${size.label}`);
  }

  // ── 7. Operative test users ──────────────────────────────────────────────────
  const demoHash = hashPassword(DEMO_PASSWORD);

  type DemoUser = { username: string; fullName: string; email: string; roles: RoleCode[] };
  const demoUsers: DemoUser[] = [
    { username: "vendedor", fullName: "Vendedor Demo", email: "vendedor@hammer.local", roles: [RoleCode.SALES] },
    { username: "cajero", fullName: "Cajero Demo", email: "cajero@hammer.local", roles: [RoleCode.CASHIER] },
    // [V2] Vendedor + Cajero = combined SALES + CASHIER memberships (no native SALES_CASHIER role).
    { username: "vendedor-cajero", fullName: "Vendedor-Cajero Demo", email: "vendedor.cajero@hammer.local", roles: [RoleCode.SALES, RoleCode.CASHIER] },
    { username: "admin-sucursal", fullName: "Administrador de Sucursal Demo", email: "admin.sucursal@hammer.local", roles: [RoleCode.BRANCH_ADMIN] },
  ];

  for (const du of demoUsers) {
    const user = await prisma.user.upsert({
      where: { username: du.username },
      update: { fullName: du.fullName, email: du.email, isActive: true, globalRole: null },
      create: {
        username: du.username,
        fullName: du.fullName,
        email: du.email,
        globalRole: null,
        passwordHash: demoHash,
        mustChangePassword: false,
        isActive: true,
      },
    });

    for (const roleCode of du.roles) {
      await prisma.userBranchRole.upsert({
        where: { userId_branchId_roleCode: { userId: user.id, branchId: msy.id, roleCode } },
        update: { isActive: true },
        create: { userId: user.id, branchId: msy.id, roleCode },
      });
    }
    console.log(`  ✔ User "${user.username}" -> [${du.roles.join(", ")}] @ ${msy.code}`);
  }

  // ── Audit log ────────────────────────────────────────────────────────────────
  await prisma.auditLog.create({
    data: {
      actorUserId: masterUser.id,
      branchId: msy.id,
      module: "seed",
      action: "SEED_COMPLETE_V2",
      entityType: "User",
      entityId: masterUser.id,
      metadataJson: {
        branches: [MGA_CODE, MSY_CODE],
        ironGroups: IRON_SIZES.map((s) => s.code),
        demoUsers: demoUsers.map((u) => u.username),
        environment: "development",
      },
    },
  });

  console.log("✅ Seed V2 completed successfully.");
  console.log("   ──────────────────────────────────────────────");
  console.log(`   Master:          ${MASTER_USERNAME} / ${MASTER_PASSWORD}`);
  console.log(`   Demo users:      vendedor, cajero, vendedor-cajero, admin-sucursal`);
  console.log(`   Demo password:   ${DEMO_PASSWORD}`);
  console.log(`   Demo branch:     ${MSY_NAME} (${MSY_CODE}) — HYBRID`);
  console.log(`   Cash box:        Caja Principal Masaya`);
  console.log(`   Iron category:   Hierro (3/8, 1/2, 1/4 — quintal + varilla)`);
  console.log("   ──────────────────────────────────────────────");
}

main()
  .catch((error) => {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
