#!/usr/bin/env tsx
/**
 * reset-master-password.ts — Resetear la contraseña del usuario MASTER
 *
 * Usage:
 *   npx tsx scripts/reset-master-password.ts
 *
 * Genera una contraseña temporal única y segura (criptográficamente aleatoria).
 * La muestra UNA SOLA VEZ en consola — el usuario deberá cambiarla en su próximo login.
 *
 * Este script:
 *   1. Encuentra al usuario MASTER por globalRole
 *   2. Genera una contraseña temporal única con crypto.randomBytes
 *   3. Hashea y actualiza la contraseña en BD
 *   4. Marca mustChangePassword: true
 *   5. Incrementa sessionVersion para invalidar sesiones activas
 *   6. Registra la acción en audit log
 */

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/password";
import { generateTempPassword } from "../src/modules/auth/temp-password";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const master = await prisma.user.findFirst({
    where: { globalRole: "MASTER" },
    select: { id: true, username: true },
  });

  if (!master) {
    console.error("❌ No se encontró ningún usuario con rol MASTER.");
    console.error("   Ejecuta primero: npm run db:seed");
    process.exit(1);
  }

  const tempPassword = generateTempPassword();

  await prisma.user.update({
    where: { id: master.id },
    data: {
      passwordHash: hashPassword(tempPassword),
      mustChangePassword: true,
      sessionVersion: { increment: 1 },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: master.id,
      module: "auth",
      action: "MASTER_PASSWORD_RESET_BY_SCRIPT",
      entityType: "User",
      entityId: master.id,
      metadataJson: {
        method: "scripts/reset-master-password.ts",
        // NO se loguea la contraseña en texto plano en BD
      },
    },
  });

  console.log("✅ Contraseña del master reseteada exitosamente.");
  console.log(`   Usuario: ${master.username}`);
  console.log(`   Contraseña temporal: ${tempPassword}`);
  console.log("   ⚠️  Copia esta contraseña ahora — no se volverá a mostrar.");
  console.log("   ⚠️  Master deberá cambiar contraseña en su próximo login.");
}

main()
  .catch((error) => {
    console.error("❌ Error:", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
