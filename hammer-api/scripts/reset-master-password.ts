#!/usr/bin/env tsx
/**
 * reset-master-password.ts — Reset the master user password
 *
 * Usage:
 *   npx tsx scripts/reset-master-password.ts "NuevaContraseña1!"
 *   npx tsx scripts/reset-master-password.ts               # generates random password
 *
 * This script:
 *   1. Finds the MASTER user by globalRole
 *   2. Resets the password to the provided value or a random one
 *   3. Sets mustChangePassword: true so the user is forced to change it on next login
 *   4. Increments sessionVersion to invalidate all existing sessions
 *   5. Logs the action to the audit log
 */

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/password";

const prisma = new PrismaClient();

// ── Password generation ──────────────────────────────────────────────────────
function generateSecurePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*_+-=";
  const all = upper + lower + digits + symbols;

  let pwd = "";
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += lower[Math.floor(Math.random() * lower.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  pwd += symbols[Math.floor(Math.random() * symbols.length)];

  for (let i = pwd.length; i < 14; i++) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }

  return pwd
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

// ── Password validation ──────────────────────────────────────────────────────
function validatePassword(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 8) errors.push("Mínimo 8 caracteres");
  if (!/[A-Z]/.test(password)) errors.push("Necesita al menos una mayúscula");
  if (!/[a-z]/.test(password)) errors.push("Necesita al menos una minúscula");
  if (!/[0-9]/.test(password)) errors.push("Necesita al menos un número");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("Necesita al menos un carácter especial");
  return errors;
}

async function main(): Promise<void> {
  const newPassword = process.argv[2]?.trim() || generateSecurePassword();
  const isGenerated = !process.argv[2]?.trim();

  // Validate password strength
  const errors = validatePassword(newPassword);
  if (errors.length > 0) {
    console.error("❌ Contraseña inválida:");
    errors.forEach((e) => console.error(`   - ${e}`));
    process.exit(1);
  }

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

  // Reset password
  await prisma.user.update({
    where: { id: master.id },
    data: {
      passwordHash: hashPassword(newPassword),
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
        wasGenerated: isGenerated,
      },
    },
  });

  console.log("✅ Contraseña del master reseteada exitosamente.");
  console.log(`   Usuario: ${master.username}`);
  console.log(`   Nueva contraseña: ${newPassword}`);
  console.log(`   mustChangePassword: true (deberá cambiarla en el próximo login)`);
  if (isGenerated) {
    console.log("\n   ⚠️  La contraseña fue generada automáticamente. ¡Cópiala ahora!");
  }
}

main()
  .catch((error) => {
    console.error("❌ Error:", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
