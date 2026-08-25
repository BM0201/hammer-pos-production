/**
 * Auditoría (Parte A.4, prompt-tesoreria-dinero-digital.md): transferencias
 * históricas que quedaron sin cuenta destino declarada — el hueco que
 * recordSaleTenderEntriesTx (treasury/service.ts) hoy deja pasar en
 * silencio, sin entrada de libro mayor ni audit log, para method=TRANSFER
 * con bankAccountId null.
 *
 * SOLO LEE, no escribe nada. NO asigna cuentas — nadie sabe a qué cuenta
 * entró ese dinero excepto quien lo cobró, y adivinar produce un libro
 * mayor que cuadra y miente. La salida es para que Master las corrija a
 * mano (o confirme que efectivamente hay que rastrear el depósito real).
 *
 * Criterio: PaymentTender con method=TRANSFER, bankAccountId=null, y sin
 * TreasuryEntry asociada (paymentTenderId es @unique en TreasuryEntry —
 * si existiera una entrada, el hueco ya estaría cubierto por otra vía).
 *
 * Uso:
 *   npx tsx scripts/find-orphan-transfer-tenders.ts
 */
import { prisma } from "@/lib/prisma";

function num(v: unknown): number {
  return Number((v as { toString?: () => string })?.toString?.() ?? v ?? 0);
}
function money(v: number): string {
  return `C$${(Math.round(v * 100) / 100).toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

async function main() {
  const orphans = await prisma.paymentTender.findMany({
    where: {
      method: "TRANSFER",
      bankAccountId: null,
      treasuryEntry: null,
    },
    select: {
      id: true,
      amount: true,
      referenceNumber: true,
      createdAt: true,
      payment: {
        select: {
          paidAt: true,
          status: true,
          saleOrder: { select: { orderNumber: true, branchId: true, branch: { select: { code: true, name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n=== Transferencias sin cuenta destino (huérfanas de libro mayor) ===\n`);

  if (orphans.length === 0) {
    console.log("Ninguna. Todas las PaymentTender TRANSFER tienen bankAccountId o ya tienen su TreasuryEntry.\n");
    await prisma.$disconnect();
    return;
  }

  console.log(`Encontradas: ${orphans.length}\n`);
  console.log("  Fecha       | Sucursal | Orden           | Monto        | Referencia | PaymentTenderId");
  let total = 0;
  const byBranch = new Map<string, { count: number; total: number }>();

  for (const t of orphans) {
    const amount = num(t.amount);
    total += amount;
    const branchCode = t.payment.saleOrder.branch.code;
    const bucket = byBranch.get(branchCode) ?? { count: 0, total: 0 };
    bucket.count += 1;
    bucket.total += amount;
    byBranch.set(branchCode, bucket);

    console.log(
      `  ${fmtDate(t.payment.paidAt)} | ${branchCode.padEnd(8)} | ${t.payment.saleOrder.orderNumber.padEnd(15)} | ${money(amount).padStart(12)} | ${(t.referenceNumber ?? "—").padEnd(10)} | ${t.id}`,
    );
  }

  console.log(`\nPor sucursal:`);
  for (const [code, b] of byBranch) {
    console.log(`  ${code.padEnd(8)} | ${b.count} transferencia(s) | ${money(b.total)}`);
  }
  console.log(`\nTOTAL: ${orphans.length} transferencia(s) por ${money(total)} sin cuenta destino registrada.\n`);
  console.log("Master: para cada una, confirmá a qué cuenta entró realmente (estado de cuenta / comprobante) y");
  console.log("registrala a mano — este script no asigna nada automáticamente.\n");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
