/**
 * prompt-correccion-ubicacion-formula-datos-prueba.md C4 — localiza filas de
 * tesorería que podrían ser datos de prueba colados en un ambiente que se ve
 * como producción. Solo lee, no borra nada: es plata, y borrar a ciegas
 * (incluso "solo" C$100) es peor que dejarlo un rato más visible mientras un
 * humano confirma cuál fila es cuál.
 *
 * Ninguno de los dos seeds (seed.ts, seed-production.ts) crea filas de
 * CashDestinationDeclaration/TreasuryEntry/BankDeposit — el caso reportado
 * (C$100 en Managua Central) no vino de un seed, vino de alguien probando el
 * flujo real de "declarar destino del efectivo" contra una base conectada.
 * Por eso este script busca por RASTRO (usuarios demo conocidos, montos
 * redondos, branchName por defecto del bootstrap) en vez de por un campo
 * "isSeed" que hoy no existe ni tendría nada que poblarlo.
 *
 * Uso: npx tsx scripts/find-treasury-test-data.ts
 */
import { prisma } from "@/lib/prisma";

// Usuarios que crea seed.ts — el único vocabulario "reservado" que ya existe
// hoy sin inventar un campo nuevo. "master" queda afuera a propósito: es una
// cuenta legítima en cualquier ambiente, seed solo le fija la contraseña inicial.
const RESERVED_DEMO_USERNAMES = ["vendedor", "cajero", "vendedor-cajero", "admin-sucursal"];

function fmt(v: number) {
  return `C$${v.toFixed(2)}`;
}

async function main() {
  const demoUsers = await prisma.user.findMany({
    where: { username: { in: RESERVED_DEMO_USERNAMES } },
    select: { id: true, username: true },
  });
  const demoUserIds = new Set(demoUsers.map((u) => u.id));
  console.log(`Usuarios demo reservados encontrados en esta base: ${demoUsers.map((u) => u.username).join(", ") || "(ninguno)"}\n`);

  console.log("=".repeat(90));
  console.log("CashDestinationDeclaration con retainAwaitingDepositPortion > 0");
  console.log("=".repeat(90));
  const declarations = await prisma.cashDestinationDeclaration.findMany({
    where: { retainAwaitingDepositPortion: { gt: 0 } },
    select: {
      id: true, retainAwaitingDepositPortion: true, createdAt: true,
      branch: { select: { code: true, name: true } },
      declaredBy: { select: { username: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  for (const d of declarations) {
    const suspect = demoUserIds.size > 0 && demoUsers.some((u) => u.username === d.declaredBy?.username);
    console.log(
      `  ${suspect ? "⚠ SOSPECHOSO" : "  "} id=${d.id} · ${d.branch.code} (${d.branch.name}) · ${fmt(Number(d.retainAwaitingDepositPortion))} · `
      + `declarado por ${d.declaredBy?.username ?? "?"} · ${d.createdAt.toISOString()}`,
    );
  }
  if (declarations.length === 0) console.log("  (ninguna)");

  console.log("");
  console.log("=".repeat(90));
  console.log("TreasuryEntry — todas las filas del libro mayor");
  console.log("=".repeat(90));
  const entries = await prisma.treasuryEntry.findMany({
    select: {
      id: true, direction: true, amount: true, entryType: true, occurredAt: true,
      account: { select: { code: true, accountAlias: true, type: true, branch: { select: { code: true } } } },
      createdBy: { select: { username: true } },
    },
    orderBy: { occurredAt: "desc" },
    take: 200,
  });
  for (const e of entries) {
    const suspect = demoUserIds.size > 0 && demoUsers.some((u) => u.username === e.createdBy?.username);
    console.log(
      `  ${suspect ? "⚠ SOSPECHOSO" : "  "} id=${e.id} · ${e.account.type} ${e.account.accountAlias} (${e.account.branch?.code ?? "central"}) · `
      + `${e.direction} ${fmt(Number(e.amount))} · ${e.entryType} · creado por ${e.createdBy?.username ?? "?"} · ${e.occurredAt.toISOString()}`,
    );
  }
  if (entries.length === 0) console.log("  (ninguna)");
  if (entries.length === 200) console.log("  … tope de 200 filas alcanzado, hay más — filtrar por fecha si hace falta ver el resto.");

  console.log("");
  console.log("=".repeat(90));
  console.log("BankDeposit — depósitos confirmados");
  console.log("=".repeat(90));
  const deposits = await prisma.bankDeposit.findMany({
    select: {
      id: true, amount: true, depositedAt: true,
      branch: { select: { code: true } },
      confirmedBy: { select: { username: true } },
    },
    orderBy: { depositedAt: "desc" },
  });
  for (const dep of deposits) {
    const suspect = demoUserIds.size > 0 && demoUsers.some((u) => u.username === dep.confirmedBy?.username);
    console.log(
      `  ${suspect ? "⚠ SOSPECHOSO" : "  "} id=${dep.id} · ${dep.branch.code} · ${fmt(Number(dep.amount))} · `
      + `confirmado por ${dep.confirmedBy?.username ?? "?"} · ${dep.depositedAt.toISOString()}`,
    );
  }
  if (deposits.length === 0) console.log("  (ninguno)");

  console.log("");
  console.log("=".repeat(90));
  const suspectCount = [...declarations, ...entries, ...deposits].filter((r: any) =>
    demoUserIds.size > 0 && demoUsers.some((u) => u.username === (r.declaredBy?.username ?? r.createdBy?.username ?? r.confirmedBy?.username)),
  ).length;
  console.log(`RESUMEN: ${declarations.length} declaraciones, ${entries.length} entradas de libro mayor, ${deposits.length} depósitos. ${suspectCount} marcadas ⚠ (creadas por un usuario demo de seed.ts).`);
  console.log("Esto NO borra nada. Confirmar cada fila sospechosa a mano antes de eliminarla — sobre todo si el monto no es obviamente de prueba (ej. no es un número redondo).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
