/**
 * Fusión de Inventario v2 — FASE 0: baseline de solo lectura.
 *
 * Para cada grupo de fusión ACTIVO y cada sucursal ACTIVA, reporta:
 *  1. Balances no-cero en miembros DERIVADOS (deberían estar en cero — el
 *     stock real vive en el canónico).
 *  2. Invariante cerrado/suelto (solo grupos tracksPackages=true):
 *     quantityOnHand del canónico == closedPackageQuantity × factor + looseUnitQuantity.
 *  3. Drift: suma de movimientos históricos (entradas − salidas, en unidades
 *     base) del canónico vs su quantityOnHand actual.
 *
 * NO repara nada. Es la foto del daño actual — la vara contra la que se
 * miden los fixes de Fase 1 (correrlo de nuevo después no debe mostrar
 * descuadres NUEVOS, solo los heredados de antes del fix).
 *
 * Uso: npx tsx scripts/verify-stock-groups.ts
 * Salida: consola + BASELINE-FUSION.md en la raíz del repo.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const EPSILON = new Prisma.Decimal("0.01");

// Clasificación de InventoryMovementType para el chequeo de drift (efecto en
// quantityOnHand, en unidades BASE). Tipos que no tocan InventoryBalance.quantityOnHand
// (RETURN_IN_DAMAGED vive en InventoryConditionBalance) o que son una simple
// redistribución cerrado↔suelto net-cero (PACKAGE_OPENED, PACKAGE_AUTO_OPENED)
// se excluyen a propósito — sumarlos como entrada/salida daría un falso drift.
// LOOSE_ADJUSTMENT/PACKAGE_ADJUSTMENT/RETURN_OUT/PRODUCTION_WASTE están
// declarados en el enum pero no se crean en ningún flujo actual (verificado
// por grep) — se listan igual por completitud, sin efecto práctico hoy.
const INBOUND_FOR_DRIFT = new Set([
  "PURCHASE_IN", "RETURN_IN", "ADJUSTMENT_IN", "TRANSFER_IN",
  "PACKAGE_IN", "LOOSE_UNIT_RETURN_IN", "TIMBER_INTAKE_IN", "PRODUCTION_OUTPUT",
]);
const OUTBOUND_FOR_DRIFT = new Set([
  "SALE_OUT", "RETURN_OUT", "ADJUSTMENT_OUT", "TRANSFER_OUT",
  "PACKAGE_SALE_OUT", "LOOSE_UNIT_SALE_OUT", "PRODUCTION_CONSUME", "PRODUCTION_WASTE",
]);
const NEUTRAL_FOR_DRIFT = new Set(["PACKAGE_OPENED", "PACKAGE_AUTO_OPENED", "RETURN_IN_DAMAGED", "LOOSE_ADJUSTMENT", "PACKAGE_ADJUSTMENT"]);

type Mismatch = {
  groupCode: string;
  groupName: string;
  branchCode: string;
  kind: "DERIVED_NONZERO" | "INVARIANT" | "DRIFT";
  detail: string;
  expected: string;
  actual: string;
  diff: string;
};

function d(v: Prisma.Decimal | number | null | undefined) {
  return new Prisma.Decimal(v ?? 0);
}

async function main() {
  const groups = await prisma.productStockGroup.findMany({
    where: { isActive: true },
    include: {
      products: {
        where: { isActive: true },
        select: { productId: true, isCanonical: true, conversionFactor: true, isPackagePresentation: true },
        orderBy: [{ isCanonical: "desc" }, { conversionFactor: "asc" }],
      },
    },
    orderBy: { code: "asc" },
  });
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
    orderBy: { code: "asc" },
  });

  const mismatches: Mismatch[] = [];
  let groupsChecked = 0;
  let branchChecksRun = 0;

  for (const group of groups) {
    const canonical = group.products.find((m) => m.isCanonical);
    if (!canonical) continue; // ya inválido — fuera de alcance de este baseline
    const derived = group.products.filter((m) => !m.isCanonical);
    const allProductIds = group.products.map((m) => m.productId);
    groupsChecked += 1;

    const packageMember = group.tracksPackages
      ? group.products.find((m) => m.isPackagePresentation && !m.isCanonical) ?? derived[0]
      : null;
    const factor = group.tracksPackages
      ? new Prisma.Decimal(group.conversionFactorToBase ?? packageMember?.conversionFactor ?? 1)
      : null;

    for (const branch of branches) {
      branchChecksRun += 1;
      const balances = await prisma.inventoryBalance.findMany({
        where: { branchId: branch.id, productId: { in: allProductIds } },
      });
      const balanceByProduct = new Map(balances.map((b) => [b.productId, b]));
      const canonicalBalance = balanceByProduct.get(canonical.productId);

      // 1) Balances no-cero en miembros derivados.
      for (const member of derived) {
        const balance = balanceByProduct.get(member.productId);
        if (!balance) continue;
        const nonZero = balance.quantityOnHand.abs().gt(EPSILON)
          || balance.closedPackageQuantity.abs().gt(EPSILON)
          || balance.looseUnitQuantity.abs().gt(EPSILON);
        if (nonZero) {
          mismatches.push({
            groupCode: group.code,
            groupName: group.name,
            branchCode: branch.code,
            kind: "DERIVED_NONZERO",
            detail: `miembro derivado ${member.productId} debería estar en cero`,
            expected: "0",
            actual: `qty=${balance.quantityOnHand.toString()} closed=${balance.closedPackageQuantity.toString()} loose=${balance.looseUnitQuantity.toString()}`,
            diff: balance.quantityOnHand.toString(),
          });
        }
      }

      // 2) Invariante cerrado/suelto (solo tracksPackages).
      if (group.tracksPackages && canonicalBalance && factor) {
        const expectedQty = canonicalBalance.closedPackageQuantity.mul(factor).add(canonicalBalance.looseUnitQuantity);
        const diff = canonicalBalance.quantityOnHand.sub(expectedQty);
        if (diff.abs().gt(EPSILON)) {
          mismatches.push({
            groupCode: group.code,
            groupName: group.name,
            branchCode: branch.code,
            kind: "INVARIANT",
            detail: "quantityOnHand != closedPackageQuantity*factor + looseUnitQuantity",
            expected: expectedQty.toString(),
            actual: canonicalBalance.quantityOnHand.toString(),
            diff: diff.toString(),
          });
        }
      }

      // 3) Drift: histórico de movimientos del canónico vs balance actual.
      if (canonicalBalance) {
        const movements = await prisma.inventoryMovement.findMany({
          where: { branchId: branch.id, productId: canonical.productId },
          select: { movementType: true, quantity: true },
        });
        let reconstructed = new Prisma.Decimal(0);
        const unclassified = new Set<string>();
        for (const mv of movements) {
          if (INBOUND_FOR_DRIFT.has(mv.movementType)) reconstructed = reconstructed.add(mv.quantity);
          else if (OUTBOUND_FOR_DRIFT.has(mv.movementType)) reconstructed = reconstructed.sub(mv.quantity);
          else if (!NEUTRAL_FOR_DRIFT.has(mv.movementType)) unclassified.add(mv.movementType);
        }
        const diff = canonicalBalance.quantityOnHand.sub(reconstructed);
        if (diff.abs().gt(EPSILON)) {
          mismatches.push({
            groupCode: group.code,
            groupName: group.name,
            branchCode: branch.code,
            kind: "DRIFT",
            detail: unclassified.size > 0
              ? `tipos no clasificados en el historico: ${[...unclassified].join(", ")}`
              : "suma de movimientos historicos no cuadra con el balance actual",
            expected: reconstructed.toString(),
            actual: canonicalBalance.quantityOnHand.toString(),
            diff: diff.toString(),
          });
        }
      }
    }
  }

  // ── Salida por consola ──────────────────────────────────────────────
  console.log(`Fusión de Inventario v2 — baseline: ${groupsChecked} grupo(s) activo(s), ${branchChecksRun} chequeo(s) grupo×sucursal.`);
  console.log(`Descuadres encontrados: ${mismatches.length}.\n`);
  for (const m of mismatches) {
    console.log(`[${m.kind}] ${m.groupCode} (${m.groupName}) @ ${m.branchCode} — ${m.detail} | esperado=${m.expected} actual=${m.actual} diff=${m.diff}`);
  }

  // ── BASELINE-FUSION.md ───────────────────────────────────────────────
  const now = new Date().toISOString();
  const byKind = {
    DERIVED_NONZERO: mismatches.filter((m) => m.kind === "DERIVED_NONZERO"),
    INVARIANT: mismatches.filter((m) => m.kind === "INVARIANT"),
    DRIFT: mismatches.filter((m) => m.kind === "DRIFT"),
  };
  const lines: string[] = [];
  lines.push(`# BASELINE-FUSION.md`);
  lines.push("");
  lines.push(`Generado: ${now}`);
  lines.push(`Grupos activos verificados: ${groupsChecked}`);
  lines.push(`Chequeos grupo×sucursal: ${branchChecksRun}`);
  lines.push(`Total de descuadres: ${mismatches.length}`);
  lines.push("");
  lines.push("Esta es la foto del daño actual — la vara contra la que se mide todo lo demás.");
  lines.push("No se reparó nada al generar este archivo. Ver prompt-fusion-inventario-v2.md, Fase 0.");
  lines.push("");

  for (const [kind, rows] of Object.entries(byKind)) {
    lines.push(`## ${kind} (${rows.length})`);
    lines.push("");
    if (rows.length === 0) {
      lines.push("_Sin descuadres de este tipo._");
      lines.push("");
      continue;
    }
    lines.push("| Grupo | Sucursal | Detalle | Esperado | Actual | Diferencia |");
    lines.push("|---|---|---|---|---|---|");
    for (const m of rows) {
      lines.push(`| ${m.groupCode} (${m.groupName}) | ${m.branchCode} | ${m.detail} | ${m.expected} | ${m.actual} | ${m.diff} |`);
    }
    lines.push("");
  }

  const outputPath = join(process.cwd(), "..", "BASELINE-FUSION.md");
  writeFileSync(outputPath, lines.join("\n"), "utf-8");
  console.log(`\nEscrito: ${outputPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
