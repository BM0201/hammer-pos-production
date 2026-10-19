/**
 * Cierre de prompt-codigos-editar-eliminar.md — tiempo de respuesta real de
 * suggestProductsForBarcode (GET /api/catalog/barcodes/suggest) y EXPLAIN
 * ANALYZE de la consulta de prefijo (LIKE) contra el catálogo real, la
 * misma que usa findManufacturerSiblingsTx en barcode-suggestions-service.ts.
 *
 * Limitación honesta: el índice nuevo (ProductBarcode_code_prefix_idx,
 * text_pattern_ops, migración 20261015000000_product_barcode_prefix_index)
 * es un archivo de migración SIN aplicar a la base de producción — por
 * convenio de esta sesión nunca se corre `prisma migrate deploy` contra
 * producción sin autorización explícita y por separado de esta consulta de
 * solo lectura. Este EXPLAIN muestra el plan de HOY (sin el índice nuevo),
 * no el plan posterior a aplicarlo. Con ~55 códigos en toda la tabla
 * ProductBarcode, cualquier plan (seq scan o index scan) es instantáneo de
 * todos modos — la medición que de verdad importaría es con un catálogo
 * bastante más grande, cuando el seq scan empiece a doler.
 *
 * Solo lee — EXPLAIN ANALYZE ejecuta el SELECT de verdad (para medir
 * tiempo real) pero no escribe nada.
 *
 * Uso: npx tsx scripts/report-suggest-performance.ts
 */
import { prisma } from "@/lib/prisma";
import { suggestProductsForBarcode } from "@/modules/catalog/barcode-suggestions-service";

async function main() {
  const sample = await prisma.productBarcode.findFirst({ where: { kind: "FACTORY" }, select: { code: true } });
  if (!sample) {
    console.log("No hay códigos FACTORY en producción — nada que medir.");
    return;
  }
  const prefix = sample.code.slice(0, 7);

  const t0 = Date.now();
  const result = await suggestProductsForBarcode({ code: sample.code });
  const elapsedMs = Date.now() - t0;
  console.log(`suggestProductsForBarcode(code=${sample.code}): ${elapsedMs} ms, ${result.suggestions.length} sugerencia(s) devueltas.\n`);

  const plan = await prisma.$queryRaw<Array<{ "QUERY PLAN": string }>>`
    EXPLAIN ANALYZE SELECT pb.code, pb."productId" FROM "ProductBarcode" pb WHERE pb.kind = 'FACTORY' AND pb.code LIKE ${prefix + "%"}
  `;
  console.log(`EXPLAIN ANALYZE — prefijo "${prefix}%" (índice nuevo SIN aplicar todavía):`);
  for (const row of plan) console.log(`  ${row["QUERY PLAN"]}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
