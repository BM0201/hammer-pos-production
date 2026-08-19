/** Dry-run del sweep de retención contra la BD real. Uso: npx tsx scripts/retention-dry-run.ts */
import { runRetentionSweep } from "@/modules/retention/service";
import { prisma } from "@/lib/prisma";

async function main() {
  const result = await runRetentionSweep({ dryRun: true });
  console.log(`Corte: ${result.cutoffIso} (3 años atrás)`);
  console.log("Tabla                    | Vencidos");
  console.log("-------------------------|---------");
  for (const rule of result.rules) {
    console.log(`${rule.table.padEnd(24)} | ${rule.matched}`);
  }
  console.log(`\nTotal purgable hoy: ${result.rules.reduce((s, r) => s + r.matched, 0)} (dryRun=${result.dryRun}, nada fue borrado)`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
