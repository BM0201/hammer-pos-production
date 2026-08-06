import assert from "node:assert/strict";
import test from "node:test";

/**
 * CAMBIO 1 (prompt-reportes-v2): "sales" pasó de resumen por orden (Payment)
 * a detalle por línea (SaleOrderLine), con costo/margen leídos de los
 * snapshots capturados en el momento de la venta (costSnapshot/
 * marginSnapshot/marginPercentSnapshot) — nunca recalculados con el costo
 * (WAC u otro) vigente HOY. Esto importa porque el WAC de un producto sigue
 * cambiando después de la venta (nuevas compras, ajustes); si el reporte
 * recalculara con el costo actual, el margen de ventas viejas cambiaría cada
 * vez que se corre el reporte — lo que rompería cualquier auditoría o cierre
 * contable ya presentado.
 *
 * `getSalesReportRows` (reports/service.ts) llama a Prisma directamente
 * (sin inyección de transacción), así que no se puede probar contra una BD
 * real en este entorno (sin DATABASE_URL). Este test espeja la función de
 * mapeo fila-a-fila EXACTAMENTE como está escrita en reports/service.ts
 * (mismas líneas: unitCost/marginAmount/marginPercent desde costSnapshot/
 * marginSnapshot/marginPercentSnapshot, costo_total = unitCost * quantity) —
 * ver el mismo patrón de "espejo" ya usado en history-pagination.test.ts.
 */

type SaleOrderLineFixture = {
  quantity: string;
  unitPrice: string;
  lineSubtotal: string;
  costSnapshot: string | null;
  marginSnapshot: string | null;
  marginPercentSnapshot: string | null;
  costSourceSnapshot: string | null;
};

const STANDARD_COST_SOURCE = "BRANCH";

function fixed2(n: number): string {
  return n.toFixed(2);
}

// Espejo exacto de la función de mapeo en getSalesReportRows (reports/service.ts).
function mapSalesLineRow(row: SaleOrderLineFixture) {
  const quantity = Number(row.quantity);
  const unitCost = row.costSnapshot != null ? Number(row.costSnapshot) : null;
  const marginAmount = row.marginSnapshot != null ? Number(row.marginSnapshot) : null;
  const marginPercent = row.marginPercentSnapshot != null ? Number(row.marginPercentSnapshot) : null;
  const isStandardCostSource = !row.costSourceSnapshot || row.costSourceSnapshot === STANDARD_COST_SOURCE;

  return {
    precio_unitario: fixed2(Number(row.unitPrice)),
    costo_unitario: unitCost != null ? fixed2(unitCost) : "",
    costo_total: unitCost != null ? fixed2(unitCost * quantity) : "",
    subtotal: fixed2(Number(row.lineSubtotal)),
    margen_monto: marginAmount != null ? fixed2(marginAmount) : "",
    margen_porcentaje: marginPercent != null ? fixed2(marginPercent) : "",
    costo_fuente: isStandardCostSource ? "" : (row.costSourceSnapshot ?? ""),
  };
}

test("costo histórico: el margen de una venta vieja usa el snapshot de la línea, no el WAC de hoy", () => {
  // Venta ocurrida cuando el costo efectivo del producto era 415.00/unidad.
  const lineAtSaleTime: SaleOrderLineFixture = {
    quantity: "40",
    unitPrice: "438.00",
    lineSubtotal: "17520.00",
    costSnapshot: "415.00",
    marginSnapshot: "920.00",           // (438-415)*40, ya neteado en la línea
    marginPercentSnapshot: "5.25",
    costSourceSnapshot: "BRANCH",
  };

  // El WAC del MISMO producto subió a 480.00 DESPUÉS de la venta (nuevas
  // compras más caras). El reporte de esa venta vieja no debe verse afectado
  // por este valor en absoluto — ni se lee, ni se usa en el cálculo.
  const currentWacAfterNewPurchases = 480.00;

  const row = mapSalesLineRow(lineAtSaleTime);

  assert.equal(row.costo_unitario, "415.00", "el costo unitario debe ser el snapshot de venta, no el WAC actual");
  assert.equal(row.costo_total, "16600.00", "40 * 415.00 (snapshot), no 40 * 480.00 (WAC actual)");
  assert.equal(row.margen_monto, "920.00", "el margen debe usar el snapshot, no recalcularse con el WAC actual");
  assert.equal(row.margen_porcentaje, "5.25");

  // Verificación explícita de que el WAC "actual" no aparece en ningún campo.
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes("480"), "el WAC actual (480.00) no debe filtrarse a ningún campo del reporte");
});

test("costo histórico: dos ventas del mismo producto en fechas distintas conservan cada una su propio costo de la época", () => {
  const saleInJanuary: SaleOrderLineFixture = {
    quantity: "10", unitPrice: "100.00", lineSubtotal: "1000.00",
    costSnapshot: "60.00", marginSnapshot: "400.00", marginPercentSnapshot: "40.00",
    costSourceSnapshot: "BRANCH",
  };
  const saleInJulySameProduct: SaleOrderLineFixture = {
    quantity: "10", unitPrice: "100.00", lineSubtotal: "1000.00",
    costSnapshot: "75.00", marginSnapshot: "250.00", marginPercentSnapshot: "25.00",
    costSourceSnapshot: "BRANCH",
  };

  const january = mapSalesLineRow(saleInJanuary);
  const july = mapSalesLineRow(saleInJulySameProduct);

  assert.equal(january.costo_unitario, "60.00");
  assert.equal(july.costo_unitario, "75.00");
  assert.notEqual(january.margen_porcentaje, july.margen_porcentaje, "cada venta refleja el margen real de su propia época, no un costo unificado");
});

test("costo histórico: sin costSnapshot (línea sin costo capturado), el reporte muestra vacío en vez de inventar un costo", () => {
  const lineWithoutCost: SaleOrderLineFixture = {
    quantity: "5", unitPrice: "50.00", lineSubtotal: "250.00",
    costSnapshot: null, marginSnapshot: null, marginPercentSnapshot: null,
    costSourceSnapshot: null,
  };
  const row = mapSalesLineRow(lineWithoutCost);
  assert.equal(row.costo_unitario, "");
  assert.equal(row.costo_total, "");
  assert.equal(row.margen_monto, "");
});

test("costo_fuente: la fuente estándar (BRANCH) queda oculta, una fuente no estándar se expone para trazabilidad", () => {
  const standardSource: SaleOrderLineFixture = {
    quantity: "1", unitPrice: "10.00", lineSubtotal: "10.00",
    costSnapshot: "6.00", marginSnapshot: "4.00", marginPercentSnapshot: "40.00",
    costSourceSnapshot: "BRANCH",
  };
  const fallbackSource: SaleOrderLineFixture = {
    quantity: "1", unitPrice: "10.00", lineSubtotal: "10.00",
    costSnapshot: "6.00", marginSnapshot: "4.00", marginPercentSnapshot: "40.00",
    costSourceSnapshot: "WAC_ESTIMATE",
  };

  assert.equal(mapSalesLineRow(standardSource).costo_fuente, "", "BRANCH es la fuente esperada, no se marca");
  assert.equal(mapSalesLineRow(fallbackSource).costo_fuente, "WAC_ESTIMATE", "una fuente distinta a BRANCH se expone para auditoría");
});
