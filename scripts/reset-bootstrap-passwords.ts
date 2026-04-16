import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/password";

const prisma = new PrismaClient();

const DEFAULT_BOOTSTRAP_PASSWORD = "admin123";

const BOOTSTRAP_USERNAMES = [
  "propietario",
  "master",
  "supervisor.mga",
  "vendedor.mga",
  "caja.mga",
  "bodega.mga",
  "supervisor.msy",
  "vendedor.msy",
  "caja.msy",
  "bodega.msy",
  "supervisor.riv",
  "vendedor.riv",
  "caja.riv",
  "bodega.riv",
] as const;

async function main() {
  const password = process.argv[2]?.trim() || DEFAULT_BOOTSTRAP_PASSWORD;

  if (!password) {
    throw new Error("Debes proporcionar una contraseña válida.");
  }

  const users = await prisma.user.findMany({
    where: {
      username: {
        in: [...BOOTSTRAP_USERNAMES],
      },
    },
    select: {
      id: true,
      username: true,
    },
  });

  if (users.length === 0) {
    throw new Error("No se encontraron usuarios bootstrap para resetear.");
  }

  await prisma.$transaction(
    users.map((user) =>
      prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hashPassword(password),
          mustChangePassword: false,
          isActive: true,
        },
      })
    )
  );

  const foundUsernames = new Set(users.map((user) => user.username));
  const missingUsers = BOOTSTRAP_USERNAMES.filter((username) => !foundUsernames.has(username));

  console.log(`✅ Reset completado para ${users.length} usuario(s).`);
  console.log(`🔐 Nueva contraseña bootstrap: ${password}`);

  if (missingUsers.length > 0) {
    console.log("⚠️ Usuarios bootstrap no encontrados (se omiten):");
    for (const username of missingUsers) {
      console.log(`   - ${username}`);
    }
  }
}

main()
  .catch((error) => {
    console.error("❌ Error reseteando contraseñas bootstrap:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
