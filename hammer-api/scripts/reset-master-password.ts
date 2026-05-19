#!/usr/bin/env tsx
/**
 * reset-master-password.ts — Reset the master user password
 *
 * Usage:
 *   npx tsx scripts/reset-master-password.ts
 *
 * This script:
 *   1. Finds the MASTER user by globalRole
 *   2. Resets the password to ElChele1234! (contraseña universal)
 *   3. Sets mustChangePassword: true so the user is forced to change it on next login
 *   4. Increments sessionVersion to invalidate all existing sessions
 *   5. Logs the action to the audit log
 */

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/password";

const prisma = new PrismaClient();

/** Contraseña universal — siempre la misma para todos los resets */
const INITIAL_PASSWORD = "ElChele1234!";

async function main(): Promise<void> {
  // Find master user
  const master = await prisma.user.findFirst({
    where: { globalRole: "MASTER" },
    select: { id: true, username: true },
  });

  if (!master) {
    console.error("❌ No se encontró ningún usuario con rol MASTER.");
    console.error("   Ejecuta primero: npm run db:seed");
    process.exit(1);
  }

  // Reset password to universal initial password
  await prisma.user.update({
    where: { id: master.id },
    data: {
      passwordHash: hashPassword(INITIAL_PASSWORD),
      mustChangePassword: true,
      sessionVersion: { increment: 1 },
    },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      actorUserId: master.id,
      module: "auth",
      action: "MASTER_PASSWORD_RESET_BY_SCRIPT",
      entityType: "User",
      entityId: master.id,
      metadataJson: {
        method: "scripts/reset-master-password.ts",
        passwordResetTo: "ElChele1234!",
      },
    },
  });

  console.log("✅ Contraseña del master reseteada exitosamente.");
  console.log(`   Usuario: ${master.username}`);
  console.log(`   Contraseña restablecida a: ElChele1234!`);
  console.log(`   mustChangePassword: true`);
  console.log("   ⚠️  Master deberá cambiar contraseña en su próximo login");
}

main()
  .catch((error) => {
    console.error("❌ Error:", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
