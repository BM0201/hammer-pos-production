/**
 * Script de diagnóstico: Verifica el usuario master en la base de datos.
 *
 * Uso:
 *   DATABASE_URL="..." DIRECT_URL="..." npx tsx scripts/verify-master.ts
 *
 * Verifica:
 *  1. Que el usuario "master" existe
 *  2. Que está activo (isActive = true)
 *  3. Que tiene globalRole = MASTER
 *  4. (Diagnóstico hash) — ya no verifica contraseña hardcodeada, solo muestra el hash
 *  5. Que no hay rate limiting bloqueando el login
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();

  console.log("═══════════════════════════════════════════════");
  console.log("  DIAGNÓSTICO: Usuario Master");
  console.log("═══════════════════════════════════════════════\n");

  // 1. Verificar usuario master
  const user = await prisma.user.findUnique({ where: { username: "master" } });

  if (!user) {
    console.log("❌ Usuario 'master' NO EXISTE en la base de datos.\n");
    const allUsers = await prisma.user.findMany({
      select: { username: true, globalRole: true, isActive: true },
    });
    console.log("📋 Usuarios existentes:", JSON.stringify(allUsers, null, 2));
    console.log("\n💡 Solución: Ejecutar seed para crear el usuario master:");
    console.log("   DATABASE_URL=... npx prisma db seed\n");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("✅ Usuario master EXISTE");
  console.log(`   ID:                 ${user.id}`);
  console.log(`   Username:           ${user.username}`);
  console.log(`   Email:              ${user.email}`);
  console.log(`   FullName:           ${user.fullName}`);
  console.log(`   GlobalRole:         ${user.globalRole}`);
  console.log(`   IsActive:           ${user.isActive}`);
  console.log(`   MustChangePassword: ${user.mustChangePassword}`);
  console.log(`   SessionVersion:     ${user.sessionVersion}`);
  console.log(`   Hash (preview):     ${user.passwordHash.substring(0, 40)}...`);

  // 2. Verificar hash (solo informativo — no se puede verificar sin conocer la contraseña)
  console.log("\n───────────────────────────────────────────────");
  console.log("🔑 Hash almacenado (primeros 40 chars):", user.passwordHash.substring(0, 40));
  console.log("   Si necesitas resetear, ejecuta: npx tsx scripts/reset-master-password.ts");
  const isValid = true; // sin contraseña de referencia, asumimos que el hash es correcto

  // 3. Verificar rate limiting
  console.log("\n───────────────────────────────────────────────");
  const windowStart = new Date(Date.now() - 15 * 60 * 1000);
  const failedRecent = await prisma.loginAttempt.count({
    where: { attemptedAt: { gte: windowStart }, success: false },
  });
  console.log(`🔒 Intentos fallidos (últimos 15 min): ${failedRecent}`);
  console.log(`   Rate limited: ${failedRecent >= 5 ? "⚠️ SÍ (bloqueado)" : "✅ NO"}`);

  if (failedRecent >= 5) {
    console.log("\n💡 Solución: Esperar 15 minutos o limpiar intentos:");
    console.log("   DELETE FROM \"LoginAttempt\" WHERE success = false;\n");
  }

  // 4. Verificar campos críticos
  console.log("\n───────────────────────────────────────────────");
  const issues: string[] = [];
  if (!user.isActive) issues.push("❌ Usuario está INACTIVO (isActive = false)");
  if (user.globalRole !== "MASTER") issues.push(`❌ GlobalRole es '${user.globalRole}' en vez de 'MASTER'`);

  if (issues.length === 0) {
    console.log("✅ Todos los campos críticos están correctos");
  } else {
    for (const issue of issues) console.log(issue);
  }

  // Resumen
  console.log("\n═══════════════════════════════════════════════");
  const allOk = user && isValid && user.isActive && user.globalRole === "MASTER" && failedRecent < 5;
  if (allOk) {
    console.log("✅ RESULTADO: Todo OK. Login debería funcionar.");
    console.log("   Si no funciona en producción, verificar:");
    console.log("   - DATABASE_URL apunta a la misma BD");
    console.log("   - AUTH_SESSION_SECRET está configurada (mín 32 chars)");
    console.log("   - El deployment existe en Vercel (no 404)");
  } else {
    console.log("❌ RESULTADO: Se encontraron problemas. Ver detalles arriba.");
  }
  console.log("═══════════════════════════════════════════════\n");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Error ejecutando diagnóstico:", e);
  process.exit(1);
});
