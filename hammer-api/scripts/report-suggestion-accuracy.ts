/**
 * Cierre de prompt-codigos-editar-eliminar.md — medición de precisión de
 * "¿podría ser este producto?" contra el catálogo real. Para cada código
 * FACTORY ya registrado se simula "¿y si este código recién apareciera,
 * sin registrar?": se oculta ÚNICAMENTE ese código (el resto de la tabla
 * queda intacta) y se arma el mismo pool de candidatos que usaría
 * suggestProductsForBarcode (productos sin código en las categorías de los
 * hermanos de fábrica), agregando el producto dueño real como si recién
 * hubiera quedado sin código — igual que quedaría en el mundo real si este
 * fuera su único código. Se mide en qué lugar del ranking (rankBarcodeSuggestions,
 * top 5) cae el producto dueño real.
 *
 * Solo lee — todo el cálculo es en memoria sobre filas ya traídas con
 * SELECT; nunca se borra, inserta ni actualiza nada, ni siquiera dentro de
 * una transacción revertida.
 *
 * Limitación honesta: con pocos códigos FACTORY en producción hoy, esta es
 * una muestra chica — sirve para confirmar que el motor no está roto, no
 * para una cifra estadísticamente robusta. Un producto cuyo ÚNICO código es
 * el que se está probando entra al pool como "sin código" (fiel a cómo
 * quedaría en la realidad); un producto con otros códigos además del
 * probado se deja fuera del pool, igual que en producción.
 *
 * Uso: npx tsx scripts/report-suggestion-accuracy.ts
 */
import { prisma } from "@/lib/prisma";
import {
  rankBarcodeSuggestions,
  findManufacturerSiblings,
  type SuggestionCandidate,
  type ManufacturerSibling,
} from "@/modules/catalog/barcode-suggestions";

function pct(n: number, total: number): string {
  return total === 0 ? "0" : ((n / total) * 100).toFixed(0);
}

async function main() {
  const allFactoryBarcodes = await prisma.productBarcode.findMany({
    where: { kind: "FACTORY" },
    select: { code: true, productId: true },
  });
  if (allFactoryBarcodes.length === 0) {
    console.log("No hay códigos FACTORY en producción hoy — nada que medir.");
    return;
  }

  const products = await prisma.product.findMany({
    select: { id: true, name: true, sku: true, unit: true, categoryId: true, isActive: true, mergedIntoProductId: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const barcodeCountByProduct = new Map<string, number>();
  for (const b of allFactoryBarcodes) barcodeCountByProduct.set(b.productId, (barcodeCountByProduct.get(b.productId) ?? 0) + 1);

  let top1 = 0, top3 = 0, outsideTop5 = 0, skippedNoSiblings = 0, skippedKeepsOtherCode = 0;
  const misses: string[] = [];

  for (const { code, productId } of allFactoryBarcodes) {
    const trueProduct = productById.get(productId);
    if (!trueProduct) continue;

    // Si el producto tiene OTRO código además de este, en la realidad no
    // quedaría "sin código" al ocultar este — se deja fuera, igual que
    // produción lo dejaría fuera del pool por tener barcodes:{some:{}}.
    const remainingCodes = (barcodeCountByProduct.get(productId) ?? 1) - 1;
    if (remainingCodes > 0) { skippedKeepsOtherCode += 1; continue; }

    const rawSiblingCandidates: ManufacturerSibling[] = allFactoryBarcodes
      .filter((b) => b.productId !== productId)
      .map((b) => {
        const p = productById.get(b.productId);
        return p ? { productId: b.productId, barcodeCode: b.code, name: p.name, unit: p.unit, categoryId: p.categoryId } : null;
      })
      .filter((s): s is ManufacturerSibling => s !== null);

    const trueSiblings = findManufacturerSiblings(code, rawSiblingCandidates);
    if (trueSiblings.length === 0) { skippedNoSiblings += 1; continue; }

    const siblingCategoryIds = new Set(trueSiblings.map((s) => s.categoryId));
    const candidates: SuggestionCandidate[] = products
      .filter((p) => siblingCategoryIds.has(p.categoryId) && p.isActive)
      .filter((p) => p.id === productId || (barcodeCountByProduct.get(p.id) ?? 0) === 0)
      .map((p) => ({
        productId: p.id,
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        categoryId: p.categoryId,
        hasBarcode: false,
        isActive: p.isActive,
        isMerged: p.mergedIntoProductId !== null,
        stockInBranch: 0,
        recentActivity60d: false,
      }));

    const ranked = rankBarcodeSuggestions({ code, manufacturerSiblings: rawSiblingCandidates, recentSessionProducts: [], candidates });
    const position = ranked.findIndex((r) => r.productId === productId);

    if (position === 0) top1 += 1;
    else if (position >= 1 && position <= 2) top3 += 1;
    else { outsideTop5 += 1; misses.push(`${trueProduct.sku} (${code}) — ${position === -1 ? "no apareció" : `posición ${position + 1}`}`); }
  }

  const measured = top1 + top3 + outsideTop5;
  console.log(`${allFactoryBarcodes.length} código(s) FACTORY en total.`);
  console.log(`Omitidos — el producto conserva otro código además del probado: ${skippedKeepsOtherCode}.`);
  console.log(`Omitidos — sin ningún hermano de fábrica (prefijo GS1 compartido) en todo el catálogo: ${skippedNoSiblings}.`);
  console.log(`Medidos: ${measured}.\n`);

  if (measured > 0) {
    console.log(`Top-1 (quedó primero): ${top1} (${pct(top1, measured)}%)`);
    console.log(`Top-3 (quedó 2.º o 3.º): ${top3} (${pct(top3, measured)}%)`);
    console.log(`Fuera del top-5 / no apareció: ${outsideTop5} (${pct(outsideTop5, measured)}%)`);
  }
  if (misses.length > 0) {
    console.log("\nCasos fuera del top-5:");
    for (const m of misses) console.log(`  ${m}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
