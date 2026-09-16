/**
 * Reporte completo de salud del WAC — para correr ANTES de reactivar
 * wac_drives_cost_chain (docs/WAC-DESACTIVADO.md). Corre las 3 reglas de
 * brain/detectors/wac-health-detector.ts contra TODO el catálogo de una
 * sola vez (sin el `take` que sí aplica el escaneo rutinario de Brain), y
 * lista cada fila sospechosa con sus números — para tener la lista
 * completa de qué revisar antes de reactivar el flag, en vez de
 * descubrirlo de a uno cuando alguien lo tropieza en Catálogo o Inventario.
 *
 * Solo lee — no escribe BrainDecision ni ningún otro dato (a diferencia de
 * un escaneo real de Brain, que además persiste vía persistBrainDecisions).
 *
 * Uso: npx tsx scripts/wac-health-report.ts [--branch=<code>]
 */
import { prisma } from "@/lib/prisma";
import { detectWacHealthDecisions } from "@/modules/brain/detectors/wac-health-detector";
import type { BrainDetectorContext } from "@/modules/brain/types";

function parseArgs() {
  const args = process.argv.slice(2);
  const branchFlag = args.find((a) => a.startsWith("--branch="));
  return { branchCode: branchFlag ? branchFlag.slice("--branch=".length) : undefined };
}

async function main() {
  const { branchCode } = parseArgs();
  let branchId: string | undefined;
  if (branchCode) {
    const branch = await prisma.branch.findFirst({ where: { code: branchCode }, select: { id: true, code: true } });
    if (!branch) throw new Error(`Sucursal ${branchCode} no encontrada`);
    branchId = branch.id;
  }

  const now = new Date();
  const ctx: BrainDetectorContext = {
    branchId,
    mode: "DEEP_SCAN",
    days: 1,
    now,
    since: now,
    dateFrom: now,
    dateTo: now,
    scope: { branchId, mode: "DEEP_SCAN" },
    // Sin tope — PASO 3 pide el catálogo completo de una sola corrida, no
    // la muestra recortada (take/maxEntities) que sí aplica el escaneo
    // rutinario de Brain para no pagar una consulta gigante en cada scan.
    limits: { maxIssues: 1_000_000, maxEntities: 1_000_000, timeoutMs: 300_000 },
  };

  console.log(`=== Reporte de salud del WAC${branchCode ? ` — ${branchCode}` : " — todas las sucursales"} ===\n`);
  const decisions = await detectWacHealthDecisions(ctx);

  if (decisions.length === 0) {
    console.log("Ningún WAC sospechoso encontrado con los umbrales vigentes (15% / 30% / 40%).");
    await prisma.$disconnect();
    return;
  }

  const byRule = new Map<string, typeof decisions>();
  for (const d of decisions) {
    const rule = (d.evidenceJson as { rule?: string } | null | undefined)?.rule ?? "SIN_REGLA";
    const list = byRule.get(rule) ?? [];
    list.push(d);
    byRule.set(rule, list);
  }

  for (const [rule, rows] of byRule) {
    console.log(`\n--- ${rule} (${rows.length}) ---`);
    for (const d of rows) {
      console.log(`[${d.severity}] ${d.title}`);
      console.log(`    ${d.description}`);
    }
  }

  console.log(`\nTotal: ${decisions.length} fila(s) sospechosa(s) en ${byRule.size} regla(s).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
