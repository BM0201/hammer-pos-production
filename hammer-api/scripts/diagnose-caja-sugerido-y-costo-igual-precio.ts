/**
 * Parte D (prompt-completo-pendientes-2026-10.md) — "Al terminar": dos
 * consultas de SOLO LECTURA.
 *
 * 1. §3.4 — cuántas filas tienen branchCost = branchPrice, por sucursal.
 * 2. El desglose REAL (hoy) del sugerido para los dos productos de la
 *    captura del dueño (CAJA PESADA METALICA 4X4" y ALAMBRE DE AMARRE #18,
 *    en Rivas) — usando las MISMAS funciones que usa pricing-detector.ts
 *    (resolvePolicyForProduct, buildCommercialIntelligenceForProduct,
 *    calculatePricingSuggestion), sin reimplementar nada, para responder:
 *    ¿de dónde sale el C$56 de la caja, y cambió después de f5ba6a3?
 *
 * No escribe nada. Ejecutar con:
 *   npx tsx scripts/diagnose-caja-sugerido-y-costo-igual-precio.ts
 */
import { prisma } from "@/lib/prisma";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";
import { resolvePolicyForProduct } from "@/modules/pricing/category-policy-service";
import { buildCommercialIntelligenceForProduct } from "@/modules/pricing/commercial-intelligence";
import { calculatePricingSuggestion } from "@/modules/pricing/calculator";

const SKUS = ["FER-CAJ-44-0002", "ALM-AMR-18-0001"];
const BRANCH_NAME_HINT = "Rivas";

async function main() {
  // 1. §3.4 — branchCost = branchPrice, por sucursal.
  const rows = await prisma.$queryRaw<Array<{ code: string; filas_costo_igual_precio: bigint }>>`
    SELECT b.code, COUNT(*) AS filas_costo_igual_precio
    FROM "BranchProductSetting" s JOIN "Branch" b ON b.id = s."branchId"
    WHERE s."branchCost" IS NOT NULL AND s."branchPrice" IS NOT NULL AND s."branchCost" = s."branchPrice"
    GROUP BY b.code
  `;

  // 2. Desglose real de los dos productos de la captura.
  const branch = await prisma.branch.findFirst({ where: { name: { contains: BRANCH_NAME_HINT, mode: "insensitive" } }, select: { id: true, name: true } });
  const products = await prisma.product.findMany({ where: { sku: { in: SKUS } }, select: { id: true, sku: true, name: true } });

  const breakdowns: unknown[] = [];
  if (branch) {
    for (const product of products) {
      const effective = await getEffectiveProductPricing(prisma, { branchId: branch.id, productId: product.id });
      const cost = effective.effectiveCost === null ? null : Number(effective.effectiveCost);
      const price = effective.effectivePrice === null ? null : Number(effective.effectivePrice);
      if (cost === null) {
        breakdowns.push({ sku: product.sku, name: product.name, nota: "sin costo efectivo hoy, no se puede recalcular" });
        continue;
      }
      const [policy, commercial] = await Promise.all([
        resolvePolicyForProduct({ branchId: branch.id, productId: product.id }),
        buildCommercialIntelligenceForProduct({ branchId: branch.id, productId: product.id }),
      ]);
      const suggestion = calculatePricingSuggestion({
        mode: "ADVANCED",
        baseCost: cost,
        includeTaxInCost: false,
        monthlyOperatingExpenses: policy.categoryPolicy.monthlyExpenseAllocation,
        categoryMonthlyUnits: policy.categoryPolicy.estimatedMonthlyUnits,
        estimatedMonthlyUnits: policy.categoryPolicy.estimatedMonthlyUnits,
        expenseAllocationScope: "CATEGORY",
        marginPercent: commercial.recommendedMarginPercent,
        minProfitAmount: commercial.recommendedMinProfitAmount,
        roundingRule: policy.categoryPolicy.roundingRule as any,
      });
      breakdowns.push({
        sku: product.sku,
        name: product.name,
        costoEfectivo: cost,
        precioActual: price,
        categoria: policy.categoryName,
        targetMarginPercent: policy.categoryPolicy.targetMarginPercent,
        minMarginPercent: policy.categoryPolicy.minMarginPercent,
        monthlyExpenseAllocation: policy.categoryPolicy.monthlyExpenseAllocation,
        estimatedMonthlyUnits: policy.categoryPolicy.estimatedMonthlyUnits,
        abcClass: commercial.abcClass,
        xyzClass: commercial.xyzClass,
        combinedClass: commercial.combinedClass,
        marginDelta: commercial.marginDelta,
        recommendedMarginPercent: commercial.recommendedMarginPercent,
        operatingExpensePerUnit: suggestion.operatingExpensePerUnit,
        minProfitAmount: commercial.recommendedMinProfitAmount,
        rawSuggestedPrice: suggestion.rawSuggestedPrice,
        sugeridoHoy: suggestion.suggestedPrice,
      });
    }
  }

  console.log(JSON.stringify({
    query3_4_filasCostoIgualPrecio: rows.map((r) => ({ sucursal: r.code, filas: Number(r.filas_costo_igual_precio) })),
    sucursalEncontrada: branch?.name ?? null,
    desgloseSugeridoHoy: breakdowns,
    nota: "monthlyExpenseAllocation es un campo manual por categoria (CategoryPricingPolicy), no un agregado en vivo de OperatingExpense — f5ba6a3 solo tocó analytics/dynamic-pricing.ts (la Calculadora suelta), un camino de código DISTINTO al del detector/Bandeja. Si el sugerido de hoy no coincide con el C$56 de la captura, la explicacion mas probable es la clase ABC-XYZ (ver marginDelta), no f5ba6a3.",
  }, null, 2));
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
