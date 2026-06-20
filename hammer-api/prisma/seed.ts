/**
 * seed.ts — Development / local seed  [V2 — POS/Cashier/Payments]
 *
 * Idempotent: safe to run multiple times without duplicating data.
 *
 * Creates:
 *   1. Branch "Managua Central" (MGA) + MASTER user (kept from V1).
 *   2. Branch "Masaya Central" (MSY) configured in HYBRID payment workflow.
 *   3. Physical cash box "Caja Principal Masaya".
 *   4. Test users: vendedor (SALES), cajero (CASHIER),
 *      vendedor-cajero (SALES + CASHIER), admin (BRANCH_ADMIN).
 *
 * NOTA (CORRECCIÓN 3): La categoría "Hierro" se crea MANUALMENTE en producción
 * desde el módulo de administración (/app/master) y los productos de hierro se
 * agrupan manualmente con el endpoint MASTER `POST /api/catalog/stock-groups/
 * bootstrap-iron`. La lógica de agrupación/conversión vive en
 * `src/modules/catalog/unit-conversion.ts` (detección por nombre del producto:
 * "HIERRO ..." / "VARILLA HIERRO ..."). Por eso este seed NO crea la categoría
 * "Hierro" ni productos de hierro.
 *
 * Run with:  npm run seed        (alias of `tsx prisma/seed.ts`)
 *        or:  npx prisma db seed
 */

import { PrismaClient, RoleCode } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/password";

const prisma = new PrismaClient();

// ── Defaults (can be overridden via env) ──────────────────────────────────────
const MASTER_USERNAME = process.env.MASTER_INITIAL_USERNAME ?? "master";
// MASTER_INITIAL_PASSWORD debe setearse como variable de entorno en producción.
// En desarrollo se acepta un valor por defecto solo para entornos locales.
const MASTER_PASSWORD = process.env.MASTER_INITIAL_PASSWORD ?? "Dev@Seed#2024!LocalOnly";
const MASTER_EMAIL = "master@hammer.local";
const MASTER_FULLNAME = "System Master";

const MGA_CODE = "MGA";
const MGA_NAME = "Managua Central";

const MSY_CODE = "MSY";
const MSY_NAME = "Masaya Central";

// Default password for all demo operative users.
const DEMO_PASSWORD = process.env.DEMO_USERS_PASSWORD ?? "Hammer1234!";

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

  // ── CORRECCIÓN 3: Categoría "Hierro" y productos de hierro ───────────────────
  // Este seed NO crea la categoría "Hierro" ni productos de hierro.
  // En producción la categoría "Hierro" se crea MANUALMENTE desde /app/master,
  // y los productos de hierro se agrupan manualmente con el endpoint MASTER:
  //   POST /api/catalog/stock-groups/bootstrap-iron
  // La lógica de detección/conversión (3/8 = 14 varillas/quintal, 1/2 = 8,
  // 1/4 = 30) vive en `src/modules/catalog/unit-conversion.ts` y se mantiene
  // intacta. No se siembra nada de hierro aquí para evitar datos huérfanos.

  // ── 4. Operative test users ──────────────────────────────────────────────────
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
  console.log(`   Categoría Hierro: se crea manualmente en /app/master (no se siembra)`);
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
