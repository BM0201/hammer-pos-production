/**
 * seed-production.ts — Production bootstrap
 *
 * Creates ONLY:
 *   1. One initial branch (from env BOOTSTRAP_BRANCH_CODE / BOOTSTRAP_BRANCH_NAME)
 *   2. One physical cash box (optional, BOOTSTRAP_CREATE_CASH_BOX=true)
 *   3. One MASTER user via username (from env or defaults)
 *
 * Idempotent: safe to run multiple times without duplicating data.
 * NO demo users. NO test products. NO staging orders.
 *
 * Environment variables:
 *   MASTER_INITIAL_USERNAME  (default: "master")
 *   MASTER_INITIAL_PASSWORD  (REQUIRED — must meet password policy)
 *   BOOTSTRAP_BRANCH_CODE    (default: "MGA")
 *   BOOTSTRAP_BRANCH_NAME    (default: "Managua Central")
 *   BOOTSTRAP_CREATE_CASH_BOX (default: "true")
 *   RESET_MASTER_PASSWORD     (default: "false") — if "true", resets existing master password
 */

import { PrismaClient, RoleCode } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/password";

const prisma = new PrismaClient();

// ── Password policy ──────────────────────────────────────────────────────────
const PASSWORD_POLICY = {
  minLength: 10,
  uppercase: /[A-Z]/,
  lowercase: /[a-z]/,
  number: /\d/,
  symbol: /[^A-Za-z0-9]/,
};

function assertStrongPassword(password: string, label: string): void {
  const errors: string[] = [];
  if (password.length < PASSWORD_POLICY.minLength) errors.push(`min ${PASSWORD_POLICY.minLength} chars`);
  if (!PASSWORD_POLICY.uppercase.test(password)) errors.push("needs uppercase");
  if (!PASSWORD_POLICY.lowercase.test(password)) errors.push("needs lowercase");
  if (!PASSWORD_POLICY.number.test(password)) errors.push("needs number");
  if (!PASSWORD_POLICY.symbol.test(password)) errors.push("needs symbol");

  if (errors.length > 0) {
    throw new Error(`Weak password for ${label}: ${errors.join(", ")}`);
  }
}

// ── Config from environment ──────────────────────────────────────────────────
function getConfig() {
  const masterPassword = process.env.MASTER_INITIAL_PASSWORD?.trim();
  if (!masterPassword) {
    throw new Error("MASTER_INITIAL_PASSWORD environment variable is REQUIRED for production seed.");
  }

  assertStrongPassword(masterPassword, "MASTER_INITIAL_PASSWORD");

  return {
    masterUsername: (process.env.MASTER_INITIAL_USERNAME?.trim() || "master"),
    masterPassword,
    masterEmail: "master@hammer.local",
    masterFullName: "System Master",
    branchCode: (process.env.BOOTSTRAP_BRANCH_CODE?.trim() || "MGA").toUpperCase(),
    branchName: process.env.BOOTSTRAP_BRANCH_NAME?.trim() || "Managua Central",
    createCashBox: (process.env.BOOTSTRAP_CREATE_CASH_BOX ?? "true").toLowerCase() === "true",
    resetMasterPassword: process.env.RESET_MASTER_PASSWORD === "true",
  };
}

async function main(): Promise<void> {
  const config = getConfig();

  console.log("🔧 Seed (production) — starting …");

  // ── 1. Branch ───────────────────────────────────────────────────────────────
  const branch = await prisma.branch.upsert({
    where: { code: config.branchCode },
    update: { name: config.branchName, isActive: true },
    create: { code: config.branchCode, name: config.branchName, isActive: true },
  });
  console.log(`  ✔ Branch "${branch.name}" (${branch.code})`);

  // ── 2. Physical cash box (optional) ────────────────────────────────────────
  if (config.createCashBox) {
    const cashBoxCode = `CASH-${config.branchCode}-01`;
    await prisma.physicalCashBox.upsert({
      where: { branchId_code: { branchId: branch.id, code: cashBoxCode } },
      update: { isActive: true, description: "Caja principal producción" },
      create: {
        branchId: branch.id,
        code: cashBoxCode,
        description: "Caja principal producción",
        isActive: true,
      },
    });
    console.log(`  ✔ Physical cash box "${cashBoxCode}"`);
  } else {
    console.log("  ⊘ Cash box creation skipped (BOOTSTRAP_CREATE_CASH_BOX != true)");
  }

  // ── 3. Master user (lookup by username, NOT email) ─────────────────────────
  const passwordHash = hashPassword(config.masterPassword);

  const existing = await prisma.user.findUnique({
    where: { username: config.masterUsername },
    select: { id: true, username: true },
  });

  let masterUserId: string;
  let wasCreated: boolean;

  if (existing) {
    // Master already exists — only update password if explicitly requested
    if (config.resetMasterPassword) {
      await prisma.user.update({
        where: { username: config.masterUsername },
        data: {
          passwordHash,
          mustChangePassword: false,
          isActive: true,
          globalRole: RoleCode.MASTER,
        },
      });
      console.log(`  ✔ Master user "${config.masterUsername}" — password RESET`);
    } else {
      console.log(`  ✔ Master user "${config.masterUsername}" — already exists (no password change)`);
    }
    masterUserId = existing.id;
    wasCreated = false;
  } else {
    const created = await prisma.user.create({
      data: {
        username: config.masterUsername,
        email: config.masterEmail,
        fullName: config.masterFullName,
        passwordHash,
        globalRole: RoleCode.MASTER,
        mustChangePassword: false,
        isActive: true,
      },
    });
    masterUserId = created.id;
    wasCreated = true;
    console.log(`  ✔ Master user "${config.masterUsername}" — CREATED`);
  }

  // ── Bootstrap complete marker ──────────────────────────────────────────────
  await prisma.systemSetting.upsert({
    where: { key: "BOOTSTRAP_COMPLETED_AT" },
    update: { value: new Date().toISOString(), updatedByUserId: masterUserId },
    create: { key: "BOOTSTRAP_COMPLETED_AT", value: new Date().toISOString(), updatedByUserId: masterUserId },
  });

  // ── Audit log ──────────────────────────────────────────────────────────────
  await prisma.auditLog.create({
    data: {
      actorUserId: masterUserId,
      branchId: branch.id,
      module: "seed-production",
      action: "PRODUCTION_BOOTSTRAP_COMPLETED",
      entityType: "User",
      entityId: masterUserId,
      metadataJson: {
        branchCode: config.branchCode,
        masterUsername: config.masterUsername,
        masterCreated: wasCreated,
        passwordReset: config.resetMasterPassword,
        cashBoxCreated: config.createCashBox,
        environment: "production",
      },
    },
  });

  console.log("✅ Production seed completed successfully.");
  console.log(`   Branch: ${config.branchName} (${config.branchCode})`);
  console.log(`   Master: ${config.masterUsername}`);
  console.log("   Demo users: NONE");
  console.log("   Test products: NONE");
}

main()
  .catch((error) => {
    console.error("❌ Production seed failed:", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
