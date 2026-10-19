/**
 * Cierre de prompt-codigos-editar-eliminar.md — consulta de SOLO LECTURA:
 * (a) cuántos códigos tienen dígito verificador inválido, (b) cuántos
 * códigos internos (HMR-) ya no coinciden con el SKU actual del producto,
 * (c) cuántos PRODUCTOS inactivos/fusionados todavía tienen algún código, y
 * (d) cuántos PRODUCTOS tienen 3 o más códigos.
 *
 * (a) y (b) cuentan CÓDIGOS (cada fila de ProductBarcode); (c) y (d) cuentan
 * PRODUCTOS DISTINTOS, no filas — así "3+ códigos" no se mezcla con
 * "3+ filas con el problema" cuando un mismo producto tiene varios códigos.
 *
 * Solo lee — no escribe nada.
 * Uso: npx tsx scripts/report-barcode-issues-closing.ts
 */
import { prisma } from "@/lib/prisma";
import { checksumWarningForCode, buildInternalBarcode } from "@/modules/catalog/barcode";

async function main() {
  const barcodes = await prisma.productBarcode.findMany({
    select: {
      code: true,
      kind: true,
      productId: true,
      product: { select: { sku: true, isActive: true, mergedIntoProductId: true } },
    },
  });

  console.log(`${barcodes.length} código(s) de barra en total.\n`);

  const invalidChecksum = barcodes.filter((b) => checksumWarningForCode(b.code) === "CHECKSUM_INVALID");
  console.log(`(a) Dígito verificador inválido: ${invalidChecksum.length} código(s).`);
  for (const b of invalidChecksum.slice(0, 20)) console.log(`    ${b.code} (${b.kind}) · producto ${b.product.sku}`);
  if (invalidChecksum.length > 20) console.log(`    ...y ${invalidChecksum.length - 20} más.`);

  const skuMismatch = barcodes.filter((b) => b.kind === "INTERNAL" && b.code !== buildInternalBarcode(b.product.sku));
  console.log(`\n(b) Código interno (HMR-) desactualizado vs SKU actual: ${skuMismatch.length} código(s).`);
  for (const b of skuMismatch.slice(0, 20)) console.log(`    ${b.code} ≠ ${buildInternalBarcode(b.product.sku)} · producto ${b.product.sku}`);
  if (skuMismatch.length > 20) console.log(`    ...y ${skuMismatch.length - 20} más.`);

  const productsById = new Map<string, { sku: string; isActive: boolean; merged: boolean; codeCount: number }>();
  for (const b of barcodes) {
    const existing = productsById.get(b.productId);
    if (existing) {
      existing.codeCount += 1;
    } else {
      productsById.set(b.productId, { sku: b.product.sku, isActive: b.product.isActive, merged: b.product.mergedIntoProductId !== null, codeCount: 1 });
    }
  }

  const inactiveOrMergedWithCode = [...productsById.values()].filter((p) => !p.isActive || p.merged);
  console.log(`\n(c) Productos inactivos o fusionados que todavía tienen algún código: ${inactiveOrMergedWithCode.length} producto(s).`);
  for (const p of inactiveOrMergedWithCode.slice(0, 20)) console.log(`    ${p.sku} · ${p.codeCount} código(s) · ${p.merged ? "fusionado" : "inactivo"}`);
  if (inactiveOrMergedWithCode.length > 20) console.log(`    ...y ${inactiveOrMergedWithCode.length - 20} más.`);

  const threeOrMoreCodes = [...productsById.values()].filter((p) => p.codeCount >= 3);
  console.log(`\n(d) Productos con 3 o más códigos: ${threeOrMoreCodes.length} producto(s).`);
  for (const p of threeOrMoreCodes.slice(0, 20)) console.log(`    ${p.sku} · ${p.codeCount} códigos`);
  if (threeOrMoreCodes.length > 20) console.log(`    ...y ${threeOrMoreCodes.length - 20} más.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
