/**
 * seed.ts — Development / local seed
 *
 * Creates ONLY:
 *   1. One initial branch (Managua Central)
 *   2. One physical cash box for that branch
 *   3. One MASTER user (username: master, password: ElChele1234!)
 *
 * Idempotent: safe to run multiple times without duplicating data.
 * NO demo users. NO test products. NO staging orders.
 */

import { PrismaClient, RoleCode } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/password";

const prisma = new PrismaClient();

// ── Defaults (can be overridden via env) ──────────────────────────────────────
const MASTER_USERNAME = process.env.MASTER_INITIAL_USERNAME ?? "master";
const MASTER_PASSWORD = process.env.MASTER_INITIAL_PASSWORD ?? "ElChele1234!";
const MASTER_EMAIL = "master@hammer.local";
const MASTER_FULLNAME = "System Master";

const BRANCH_CODE = "MGA";
const BRANCH_NAME = "Managua Central";

async function main(): Promise<void> {
  console.log("🔧 Seed (development) — starting …");

  // ── 1. Branch ───────────────────────────────────────────────────────────────
  const branch = await prisma.branch.upsert({
    where: { code: BRANCH_CODE },
    update: { name: BRANCH_NAME, isActive: true },
    create: { code: BRANCH_CODE, name: BRANCH_NAME, isActive: true, isDefaultSupplier: true },
  });
  console.log(`  ✔ Branch "${branch.name}" (${branch.code})`);

  // ── 2. Physical cash box ───────────────────────────────────────────────────
  const cashBoxCode = `CASH-${BRANCH_CODE}-01`;
  await prisma.physicalCashBox.upsert({
    where: { branchId_code: { branchId: branch.id, code: cashBoxCode } },
    update: { isActive: true, description: "Caja principal" },
    create: {
      branchId: branch.id,
      code: cashBoxCode,
      description: "Caja principal",
      isActive: true,
    },
  });
  console.log(`  ✔ Physical cash box "${cashBoxCode}"`);

  // ── 3. Master user ─────────────────────────────────────────────────────────
  const passwordHash = hashPassword(MASTER_PASSWORD);

  const masterUser = await prisma.user.upsert({
    where: { username: MASTER_USERNAME },
    update: {
      fullName: MASTER_FULLNAME,
      email: MASTER_EMAIL,
      globalRole: RoleCode.MASTER,
      isActive: true,
      // Only reset the password if explicitly requested
      ...(process.env.RESET_MASTER_PASSWORD === "true" ? { passwordHash, mustChangePassword: true } : {}),
    },
    create: {
      username: MASTER_USERNAME,
      fullName: MASTER_FULLNAME,
      email: MASTER_EMAIL,
      globalRole: RoleCode.MASTER,
      passwordHash,
      // Master también debe cambiar contraseña en su primer login
      mustChangePassword: true,
      isActive: true,
    },
  });
  console.log(`  ✔ Master user "${masterUser.username}" (globalRole: MASTER)`);

  // ── Audit log ──────────────────────────────────────────────────────────────
  await prisma.auditLog.create({
    data: {
      actorUserId: masterUser.id,
      branchId: branch.id,
      module: "seed",
      action: "SEED_COMPLETE",
      entityType: "User",
      entityId: masterUser.id,
      metadataJson: {
        branchCode: BRANCH_CODE,
        masterUsername: MASTER_USERNAME,
        environment: "development",
      },
    },
  });

  console.log("✅ Seed completed successfully.");
  console.log(`   Branch: ${BRANCH_NAME} (${BRANCH_CODE})`);
  console.log(`   Master: ${MASTER_USERNAME}`);
  console.log(`   Contraseña inicial: ElChele1234!`);
  console.log("   ⚠️  Master deberá cambiar contraseña en su primer login");
  console.log("   Demo users: NONE");
  console.log("   Test products: NONE");
}

main()
  .catch((error) => {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
