import { prisma } from "@/lib/prisma";

/**
 * prompt-correccion-ubicacion-formula-datos-prueba.md C4/§2.4 — "un chequeo
 * de arranque en producción rechaza levantar si detecta filas de tesorería
 * marcadas como seed". En este stack (Next.js/Vercel) no hay un momento de
 * arranque único que se pueda bloquear de verdad — se adapta al equivalente
 * real: el probe de /ready, que ya existe y ya falla con 503 si la DB no
 * responde (mismo archivo). Un 503 sostenido en /ready es lo que un
 * supervisor de despliegue (o alguien mirando el dashboard) puede tratar
 * como "no está listo para servir".
 *
 * Ningún seed crea filas de tesorería (seed.ts/seed-production.ts no tocan
 * CashDestinationDeclaration/TreasuryEntry/BankDeposit), así que no hay
 * ningún campo "isSeed" real que revisar. El rastro que SÍ existe hoy, sin
 * inventar schema nuevo: los usuarios demo que seed.ts efectivamente crea
 * con nombre reservado. "master" queda afuera — es una cuenta legítima en
 * cualquier ambiente.
 */
const RESERVED_DEMO_USERNAMES = ["vendedor", "cajero", "vendedor-cajero", "admin-sucursal"];

export async function findTreasuryRowsFromDemoUsers(): Promise<{ found: boolean; detail: string[] }> {
  const demoUsers = await prisma.user.findMany({
    where: { username: { in: RESERVED_DEMO_USERNAMES } },
    select: { id: true, username: true },
  });
  if (demoUsers.length === 0) return { found: false, detail: [] };

  const demoUserIds = demoUsers.map((u) => u.id);
  const [declarationCount, entryCount, depositCount] = await Promise.all([
    prisma.cashDestinationDeclaration.count({ where: { declaredByUserId: { in: demoUserIds }, retainAwaitingDepositPortion: { gt: 0 } } }),
    prisma.treasuryEntry.count({ where: { createdByUserId: { in: demoUserIds } } }),
    prisma.bankDeposit.count({ where: { confirmedByUserId: { in: demoUserIds } } }),
  ]);

  const detail: string[] = [];
  if (declarationCount > 0) detail.push(`${declarationCount} CashDestinationDeclaration`);
  if (entryCount > 0) detail.push(`${entryCount} TreasuryEntry`);
  if (depositCount > 0) detail.push(`${depositCount} BankDeposit`);

  return { found: detail.length > 0, detail };
}
