import { formatCurrency, formatNumber, formatPercent, formatStatus, safeText, toNumber } from "@/modules/reports/report-formatters";

// CAMBIO 5 (prompt-reportes-v2): antes cada reporte tenía su propio take:2000
// (o 3000 para auditoría) hardcodeado — un rango de varios meses truncaba en
// silencio. Un rango real de 6 meses (ver mockup: ~8,900 líneas de venta,
// ~1,240 movimientos) queda comodísimo bajo este tope único; si algún día se
// supera, el aviso ahora es honesto ("mostrando N de M", con M real via
// count()), nunca un truncado silencioso. Cursor/streaming completo (sin
// ningún tope) queda fuera de alcance de este cambio — ver nota en el reporte
// final de la tarea.
export const REPORT_ROW_CAP = 20_000;

export type ReportType = "financial" | "operational" | "inventory" | "audit" | "payroll" | "generic";
export type ReportOrientation = "portrait" | "landscape";
export type ReportColumnType = "text" | "date" | "currency" | "number" | "status" | "percent";
export type ReportRow = Record<string, unknown>;

export type ReportColumnDefinition = {
  key: string;
  label: string;
  width: number;
  align?: "left" | "right" | "center";
  type: ReportColumnType;
  required?: boolean;
  hideWhenEmpty?: boolean;
  maxLength?: number;
  formatter?: (value: unknown, row: ReportRow) => string;
};

export type ReportSummaryCard = {
  label: string;
  value: string;
  note?: string;
};

export type ReportTotalDefinition = {
  key: string;
  label?: string;
  type?: "currency" | "number";
};

export type ReportDefinition = {
  reportKey: string;
  title: string;
  subtitle: string;
  description: string;
  orientation: ReportOrientation;
  type: ReportType;
  detailLabel: string;
  columns: ReportColumnDefinition[];
  totals?: ReportTotalDefinition[];
  rowLimitPolicy?: {
    serviceMaxRows: number;
    warningThreshold?: number;
  };
  summaryCards?: (rows: ReportRow[]) => ReportSummaryCard[];
  warnings?: (rows: ReportRow[]) => string[];
  metadata?: Record<string, string>;
};

function branch(row: ReportRow): string {
  const code = safeText(row.sucursal_codigo, "");
  const name = safeText(row.sucursal_nombre, "");
  return [code, name].filter(Boolean).join(" - ") || safeText(row.sucursal, "");
}

function sum(rows: ReportRow[], key: string): number {
  return rows.reduce((total, row) => total + toNumber(row[key]), 0);
}

function countBy(rows: ReportRow[], key: string, value: string): number {
  return rows.filter((row) => safeText(row[key], "") === value).length;
}

function topValue(rows: ReportRow[], key: string): string {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const value = safeText(row[key], "");
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  const [value] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return value ? formatStatus(value) : "N/D";
}

const baseBranchColumns: ReportColumnDefinition[] = [
  { key: "sucursal_codigo", label: "Suc.", width: 8, type: "text", maxLength: 8 },
  { key: "sucursal_nombre", label: "Sucursal", width: 14, type: "text", formatter: (_value, row) => branch(row), maxLength: 24 },
];

export const REPORT_DEFINITIONS: Record<string, ReportDefinition> = {
  // CAMBIO 1 (prompt-reportes-v2): "sales" pasa a ser el detalle por línea —
  // antes mostraba fecha/orden/vendedor/total sin decir QUÉ se vendió. El
  // costo/margen viene de los snapshots de la línea (costSnapshot/
  // marginSnapshot), nunca recalculado con el WAC actual.
  sales: {
    reportKey: "sales",
    title: "Reporte de Ventas — Detalle por Línea",
    subtitle: "Qué se vendió, a qué categoría, con costo y margen histórico",
    description: "Una fila por línea de venta cobrada, con costo y margen al momento de la venta.",
    orientation: "landscape",
    type: "financial",
    detailLabel: "Detalle por línea",
    columns: [
      { key: "fecha", label: "Fecha", width: 11, type: "date" },
      { key: "sucursal_codigo", label: "Suc.", width: 6, type: "text" },
      { key: "orden", label: "Orden", width: 9, type: "text", maxLength: 16 },
      { key: "producto_sku", label: "SKU", width: 9, type: "text", maxLength: 14 },
      { key: "producto_nombre", label: "Producto", width: 16, type: "text", maxLength: 26 },
      { key: "categoria", label: "Categoría", width: 11, type: "text", maxLength: 18 },
      { key: "cantidad", label: "Cant.", width: 6, type: "number", align: "right" },
      { key: "precio_unitario", label: "P.unit", width: 9, type: "currency", align: "right" },
      { key: "costo_unitario", label: "Costo", width: 9, type: "currency", align: "right" },
      { key: "subtotal", label: "Subtotal", width: 10, type: "currency", align: "right", required: true },
      { key: "margen_porcentaje", label: "Margen", width: 8, type: "percent", align: "right" },
      { key: "costo_fuente", label: "Fuente costo", width: 9, type: "text", maxLength: 14, hideWhenEmpty: true },
    ],
    totals: [
      { key: "subtotal", label: "Ingreso total", type: "currency" },
      { key: "costo_total", label: "Costo total", type: "currency" },
      { key: "margen_monto", label: "Margen bruto", type: "currency" },
    ],
    rowLimitPolicy: { serviceMaxRows: REPORT_ROW_CAP, warningThreshold: REPORT_ROW_CAP },
    summaryCards: (rows) => {
      const ingreso = sum(rows, "subtotal");
      const costo = sum(rows, "costo_total");
      const margen = sum(rows, "margen_monto");
      const ordenes = new Set(rows.map((row) => safeText(row.orden, ""))).size;
      return [
        { label: "Ingreso total", value: formatCurrency(ingreso) },
        { label: "Costo de lo vendido", value: formatCurrency(costo) },
        { label: "Margen bruto", value: `${formatCurrency(margen)} (${ingreso > 0 ? formatPercent((margen / ingreso) * 100) : "0%"})` },
        { label: "Órdenes", value: formatNumber(ordenes) },
      ];
    },
    warnings: (rows) => {
      const warnings: string[] = [];
      if (rows.length > 0 && rows.every((row) => row.costo_unitario === "" || row.costo_unitario === undefined)) {
        warnings.push("Ninguna línea tiene costo capturado — el margen no se puede calcular para este rango.");
      }
      if (rows.some((row) => safeText(row.costo_fuente, "") !== "")) {
        warnings.push("Algunas líneas usan una fuente de costo distinta a la estándar (ver columna Fuente costo).");
      }
      return warnings;
    },
  },
  // Vista "resumen por orden" — el reporte "sales" original, conservado tal
  // cual (prompt-reportes-v2 CAMBIO 1: "conservar... como opción").
  "sales-summary": {
    reportKey: "sales-summary",
    title: "Reporte de Ventas — Resumen por Orden",
    subtitle: "Ventas cobradas y trazabilidad comercial",
    description: "Reporte financiero basado en cobros registrados, una fila por orden.",
    orientation: "landscape",
    type: "financial",
    detailLabel: "Resumen por orden",
    columns: [
      { key: "fecha", label: "Fecha", width: 12, type: "date" },
      ...baseBranchColumns,
      { key: "orden", label: "Orden", width: 10, type: "text", maxLength: 16 },
      { key: "vendedor", label: "Vendedor/Cajero", width: 18, type: "text", maxLength: 24 },
      { key: "estado", label: "Estado financiero", width: 13, type: "status" },
      { key: "total", label: "Total", width: 12, type: "currency", align: "right", required: true },
    ],
    totals: [{ key: "total", label: "Total vendido", type: "currency" }],
    rowLimitPolicy: { serviceMaxRows: REPORT_ROW_CAP, warningThreshold: REPORT_ROW_CAP },
    summaryCards: (rows) => {
      const total = sum(rows, "total");
      return [
        { label: "Total vendido", value: formatCurrency(total) },
        { label: "Ordenes cobradas", value: formatNumber(rows.length) },
        { label: "Ticket promedio", value: formatCurrency(rows.length ? total / rows.length : 0) },
        { label: "Estado principal", value: topValue(rows, "estado") },
      ];
    },
    warnings: (rows) => {
      const warnings: string[] = [];
      if (rows.length > 0 && rows.every((row) => row.total === undefined || row.total === "")) {
        warnings.push("No se encontraron totales financieros en las filas recibidas.");
      }
      if (rows.some((row) => safeText(row.estado, "") === "DISPATCHED")) {
        warnings.push("Este reporte contiene ordenes despachadas; valide que tambien esten cobradas.");
      }
      return warnings;
    },
  },
  // CAMBIO 2 (prompt-reportes-v2): reusa getSalesSummaryAggregated — ver
  // reports/service.ts::getSalesByCategoryReportRows.
  "sales-by-category": {
    reportKey: "sales-by-category",
    title: "Reporte de Ventas por Categoría",
    subtitle: "Ingreso, costo y margen agrupados por categoría de producto",
    description: "Agregado por categoría — misma fuente que el dashboard de ventas.",
    orientation: "portrait",
    type: "financial",
    detailLabel: "Por categoría",
    columns: [
      { key: "categoria", label: "Categoría", width: 20, type: "text", maxLength: 28 },
      { key: "ingreso", label: "Ingreso", width: 14, type: "currency", align: "right", required: true },
      { key: "costo", label: "Costo", width: 14, type: "currency", align: "right" },
      { key: "margen_porcentaje", label: "Margen", width: 10, type: "percent", align: "right" },
      { key: "porcentaje_total", label: "% total", width: 10, type: "percent", align: "right" },
      { key: "ordenes", label: "Órdenes", width: 10, type: "number", align: "right" },
    ],
    totals: [
      { key: "ingreso", label: "Ingreso total", type: "currency" },
      { key: "costo", label: "Costo total", type: "currency" },
    ],
    rowLimitPolicy: { serviceMaxRows: 200, warningThreshold: 200 },
    summaryCards: (rows) => {
      const ingreso = sum(rows, "ingreso");
      const costo = sum(rows, "costo");
      const margen = ingreso > 0 ? ((ingreso - costo) / ingreso) * 100 : 0;
      return [
        { label: "Ingreso total", value: formatCurrency(ingreso) },
        { label: "Costo total", value: formatCurrency(costo) },
        { label: "Margen bruto", value: formatPercent(margen) },
        { label: "Categorías", value: formatNumber(rows.length) },
      ];
    },
  },
  payments: {
    reportKey: "payments",
    title: "Reporte de Cobros",
    subtitle: "Pagos, metodos y conciliacion de caja",
    description: "Reporte financiero de cobros procesados.",
    orientation: "landscape",
    type: "financial",
    detailLabel: "Detalle financiero",
    columns: [
      { key: "fecha_pago", label: "Fecha", width: 12, type: "date" },
      ...baseBranchColumns,
      { key: "orden", label: "Orden", width: 10, type: "text", maxLength: 16 },
      { key: "cajero", label: "Cajero", width: 16, type: "text", maxLength: 22 },
      { key: "metodo", label: "Metodo", width: 10, type: "status" },
      { key: "estado", label: "Estado", width: 10, type: "status" },
      { key: "monto", label: "Monto", width: 11, type: "currency", align: "right" },
      { key: "referencia", label: "Referencia", width: 12, type: "text", maxLength: 20 },
    ],
    totals: [
      { key: "monto", label: "Total cobrado", type: "currency" },
      { key: "efectivo", label: "Efectivo", type: "currency" },
      { key: "cambio", label: "Cambio", type: "currency" },
    ],
    rowLimitPolicy: { serviceMaxRows: REPORT_ROW_CAP, warningThreshold: REPORT_ROW_CAP },
    summaryCards: (rows) => [
      { label: "Total cobrado", value: formatCurrency(sum(rows, "monto")) },
      { label: "Pagos", value: formatNumber(rows.length) },
      { label: "Efectivo", value: formatCurrency(sum(rows, "efectivo")) },
      { label: "Metodo principal", value: topValue(rows, "metodo") },
    ],
  },
  discounts: {
    reportKey: "discounts",
    title: "Reporte de Descuentos",
    subtitle: "Descuentos aplicados por producto y vendedor",
    description: "Auditoria comercial de descuentos.",
    orientation: "landscape",
    type: "financial",
    detailLabel: "Detalle comercial",
    columns: [
      { key: "fecha", label: "Fecha", width: 12, type: "date" },
      { key: "sucursal_codigo", label: "Suc.", width: 7, type: "text" },
      { key: "orden", label: "Orden", width: 9, type: "text", maxLength: 14 },
      { key: "producto_sku", label: "SKU", width: 9, type: "text", maxLength: 14 },
      { key: "producto_nombre", label: "Producto", width: 19, type: "text", maxLength: 26 },
      { key: "cantidad", label: "Cant.", width: 7, type: "number", align: "right" },
      { key: "descuento_monto", label: "Desc.", width: 10, type: "currency", align: "right" },
      { key: "descuento_porcentaje_efectivo", label: "%", width: 7, type: "percent", align: "right" },
      { key: "subtotal_final", label: "Neto", width: 10, type: "currency", align: "right" },
      { key: "vendedor", label: "Vendedor", width: 14, type: "text", maxLength: 20 },
    ],
    totals: [
      { key: "descuento_monto", label: "Total descuentos", type: "currency" },
      { key: "subtotal_final", label: "Total neto", type: "currency" },
    ],
    rowLimitPolicy: { serviceMaxRows: REPORT_ROW_CAP, warningThreshold: REPORT_ROW_CAP },
    summaryCards: (rows) => [
      { label: "Descuento total", value: formatCurrency(sum(rows, "descuento_monto")) },
      { label: "Lineas", value: formatNumber(rows.length) },
      { label: "Neto impactado", value: formatCurrency(sum(rows, "subtotal_final")) },
    ],
  },
  dispatch: {
    reportKey: "dispatch",
    title: "Reporte de Despachos",
    subtitle: "Seguimiento operativo de tickets de despacho",
    description: "Reporte operativo; no representa venta cobrada.",
    orientation: "landscape",
    type: "operational",
    detailLabel: "Detalle operativo",
    columns: [
      { key: "fecha", label: "Fecha ticket", width: 12, type: "date" },
      ...baseBranchColumns,
      { key: "orden", label: "Orden", width: 10, type: "text", maxLength: 16 },
      { key: "estado", label: "Estado despacho", width: 13, type: "status" },
      { key: "despachado_por", label: "Responsable", width: 17, type: "text", maxLength: 24 },
      { key: "fecha_despacho", label: "Fecha despacho", width: 12, type: "date" },
      { key: "notas", label: "Notas/Zona", width: 16, type: "text", maxLength: 24 },
    ],
    rowLimitPolicy: { serviceMaxRows: REPORT_ROW_CAP, warningThreshold: REPORT_ROW_CAP },
    summaryCards: (rows) => [
      { label: "Tickets", value: formatNumber(rows.length) },
      { label: "Despachados", value: formatNumber(countBy(rows, "estado", "DISPATCHED")) },
      { label: "Pendientes", value: formatNumber(countBy(rows, "estado", "PENDING")) },
      { label: "En transito", value: formatNumber(countBy(rows, "estado", "IN_TRANSIT")) },
    ],
    warnings: () => ["Reporte operativo de despacho; no debe interpretarse como reporte de venta cobrada."],
  },
  approvals: {
    reportKey: "approvals",
    title: "Reporte de Aprobaciones",
    subtitle: "Solicitudes, resoluciones y excepciones",
    description: "Control gerencial de aprobaciones.",
    orientation: "landscape",
    type: "audit",
    detailLabel: "Detalle de aprobaciones",
    columns: [
      { key: "fecha_solicitud", label: "Fecha", width: 12, type: "date" },
      ...baseBranchColumns,
      { key: "tipo", label: "Tipo", width: 12, type: "text", maxLength: 18 },
      { key: "estado", label: "Estado", width: 10, type: "status" },
      { key: "solicitado_por", label: "Solicitado por", width: 17, type: "text", maxLength: 24 },
      { key: "resuelto_por", label: "Resuelto por", width: 15, type: "text", maxLength: 22 },
      { key: "motivo", label: "Motivo", width: 16, type: "text", maxLength: 24 },
    ],
    rowLimitPolicy: { serviceMaxRows: REPORT_ROW_CAP, warningThreshold: REPORT_ROW_CAP },
    summaryCards: (rows) => [
      { label: "Solicitudes", value: formatNumber(rows.length) },
      { label: "Pendientes", value: formatNumber(countBy(rows, "estado", "PENDING")) },
      { label: "Aprobadas", value: formatNumber(countBy(rows, "estado", "APPROVED")) },
      { label: "Rechazadas", value: formatNumber(countBy(rows, "estado", "REJECTED")) },
    ],
  },
  audit: {
    reportKey: "audit",
    title: "Reporte de Auditoria",
    subtitle: "Trazabilidad de acciones del sistema",
    description: "Bitacora administrativa de auditoria.",
    orientation: "landscape",
    type: "audit",
    detailLabel: "Auditoria",
    columns: [
      { key: "fecha", label: "Fecha", width: 12, type: "date" },
      { key: "sucursal_codigo", label: "Suc.", width: 7, type: "text" },
      { key: "usuario", label: "Usuario", width: 18, type: "text", maxLength: 26 },
      { key: "accion", label: "Accion", width: 18, type: "text", maxLength: 26 },
      { key: "modulo", label: "Modulo", width: 13, type: "text", maxLength: 18 },
      { key: "entidad", label: "Entidad", width: 13, type: "text", maxLength: 18 },
      { key: "entidad_id", label: "ID", width: 12, type: "text", maxLength: 18 },
    ],
    rowLimitPolicy: { serviceMaxRows: REPORT_ROW_CAP, warningThreshold: REPORT_ROW_CAP },
    summaryCards: (rows) => [
      { label: "Eventos", value: formatNumber(rows.length) },
      { label: "Modulo principal", value: topValue(rows, "modulo") },
      { label: "Accion principal", value: topValue(rows, "accion") },
    ],
  },
  "inventory-critical": {
    reportKey: "inventory-critical",
    title: "Reporte de Inventario Critico",
    subtitle: "Alertas por existencia baja",
    description: "Productos con existencia critica por sucursal.",
    orientation: "portrait",
    type: "inventory",
    detailLabel: "Alertas de inventario",
    columns: [
      ...baseBranchColumns,
      { key: "sku", label: "SKU", width: 13, type: "text", maxLength: 18 },
      { key: "producto", label: "Producto", width: 24, type: "text", maxLength: 30 },
      { key: "existencia", label: "Stock actual", width: 12, type: "number", align: "right" },
      { key: "costo_promedio", label: "Costo prom.", width: 13, type: "currency", align: "right" },
      { key: "valor_inventario", label: "Valor", width: 13, type: "currency", align: "right" },
    ],
    totals: [{ key: "valor_inventario", label: "Valor inventario", type: "currency" }],
    rowLimitPolicy: { serviceMaxRows: REPORT_ROW_CAP, warningThreshold: REPORT_ROW_CAP },
    summaryCards: (rows) => [
      { label: "Total alertas", value: formatNumber(rows.length) },
      { label: "Agotados", value: formatNumber(rows.filter((row) => toNumber(row.existencia) <= 0).length) },
      { label: "Criticos", value: formatNumber(rows.filter((row) => toNumber(row.existencia) > 0 && toNumber(row.existencia) <= 5).length) },
      { label: "Valor", value: formatCurrency(sum(rows, "valor_inventario")) },
    ],
  },
  // CAMBIO 4 (prompt-reportes-v2): nunca existió reporte de InventoryMovement.
  // Grupo (envíos/ingresos/conteos/ventas) viene de movement-groups.ts.
  "inventory-movements": {
    reportKey: "inventory-movements",
    title: "Reporte de Movimientos de Materiales",
    subtitle: "Cada movimiento de inventario, agrupado por tipo",
    description: "Envíos, ingresos, conteos/ajustes y ventas de materiales — nunca tuvo reporte propio.",
    orientation: "landscape",
    type: "inventory",
    detailLabel: "Movimientos de materiales",
    columns: [
      { key: "fecha", label: "Fecha", width: 11, type: "date" },
      { key: "sucursal_codigo", label: "Suc.", width: 6, type: "text" },
      { key: "grupo", label: "Grupo", width: 10, type: "text", maxLength: 16 },
      { key: "tipo", label: "Tipo", width: 12, type: "status" },
      { key: "producto_nombre", label: "Producto", width: 17, type: "text", maxLength: 26 },
      { key: "categoria", label: "Categoría", width: 11, type: "text", maxLength: 18 },
      { key: "cantidad", label: "Cant.", width: 7, type: "number", align: "right" },
      { key: "costo_unitario", label: "Costo", width: 9, type: "currency", align: "right" },
      { key: "valor", label: "Valor", width: 10, type: "currency", align: "right", required: true },
      { key: "origen_destino", label: "Origen → Destino", width: 12, type: "text", maxLength: 18, hideWhenEmpty: true },
      { key: "referencia", label: "Ref.", width: 9, type: "text", maxLength: 16 },
      { key: "motivo", label: "Motivo", width: 12, type: "text", maxLength: 18, hideWhenEmpty: true },
    ],
    totals: [{ key: "valor", label: "Valor neto", type: "currency" }],
    rowLimitPolicy: { serviceMaxRows: REPORT_ROW_CAP, warningThreshold: REPORT_ROW_CAP },
    summaryCards: (rows) => [
      { label: "Envíos", value: formatCurrency(sum(rows.filter((row) => safeText(row.grupo, "") === "Envíos"), "valor")) },
      { label: "Ingresos", value: formatCurrency(sum(rows.filter((row) => safeText(row.grupo, "") === "Ingresos"), "valor")) },
      { label: "Conteos y ajustes", value: formatCurrency(sum(rows.filter((row) => safeText(row.grupo, "") === "Conteos y ajustes"), "valor")) },
      { label: "Ventas de materiales", value: formatCurrency(sum(rows.filter((row) => safeText(row.grupo, "") === "Ventas de materiales"), "valor")) },
    ],
  },
  payroll: {
    reportKey: "payroll",
    title: "Reporte de Nomina",
    subtitle: "Pagos, deducciones y costo laboral",
    description: "Reporte financiero de nomina.",
    orientation: "landscape",
    type: "payroll",
    detailLabel: "Detalle de nomina",
    columns: [
      { key: "ano", label: "Ano", width: 6, type: "number" },
      { key: "mes", label: "Mes", width: 6, type: "number" },
      { key: "sucursal", label: "Sucursal", width: 14, type: "text", maxLength: 22 },
      { key: "empleado", label: "Empleado", width: 17, type: "text", maxLength: 24 },
      { key: "puesto", label: "Puesto", width: 13, type: "text", maxLength: 18 },
      { key: "salario_bruto", label: "Bruto", width: 10, type: "currency", align: "right" },
      { key: "deducciones_prestamos", label: "Prestamos", width: 10, type: "currency", align: "right" },
      { key: "otras_deducciones", label: "Otras ded.", width: 10, type: "currency", align: "right" },
      { key: "neto_a_pagar", label: "Neto", width: 10, type: "currency", align: "right" },
      { key: "estado_run", label: "Estado", width: 10, type: "status" },
    ],
    totals: [
      { key: "salario_bruto", label: "Bruto", type: "currency" },
      { key: "deducciones_prestamos", label: "Prestamos", type: "currency" },
      { key: "otras_deducciones", label: "Otras ded.", type: "currency" },
      { key: "neto_a_pagar", label: "Neto", type: "currency" },
      { key: "costo_empresa", label: "Costo empresa", type: "currency" },
    ],
    rowLimitPolicy: { serviceMaxRows: REPORT_ROW_CAP, warningThreshold: REPORT_ROW_CAP },
    summaryCards: (rows) => [
      { label: "Neto a pagar", value: formatCurrency(sum(rows, "neto_a_pagar")) },
      { label: "Empleados", value: formatNumber(rows.length) },
      { label: "Deducciones", value: formatCurrency(sum(rows, "deducciones_prestamos") + sum(rows, "otras_deducciones")) },
      { label: "Costo empresa", value: formatCurrency(sum(rows, "costo_empresa")) },
    ],
  },
  "employee-loans": {
    reportKey: "employee-loans",
    title: "Reporte de Prestamos de Empleados",
    subtitle: "Saldos, cuotas y estado de prestamos",
    description: "Seguimiento financiero de prestamos internos.",
    orientation: "landscape",
    type: "payroll",
    detailLabel: "Detalle de prestamos",
    columns: [
      { key: "fecha", label: "Fecha", width: 12, type: "date" },
      { key: "sucursal", label: "Sucursal", width: 18, type: "text", maxLength: 26 },
      { key: "empleado", label: "Empleado", width: 20, type: "text", maxLength: 28 },
      { key: "monto_original", label: "Monto original", width: 13, type: "currency", align: "right" },
      { key: "saldo_pendiente", label: "Saldo", width: 13, type: "currency", align: "right" },
      { key: "cuota", label: "Cuota", width: 10, type: "currency", align: "right" },
      { key: "estado", label: "Estado", width: 10, type: "status" },
      { key: "notas", label: "Notas", width: 14, type: "text", maxLength: 22 },
    ],
    totals: [
      { key: "monto_original", label: "Monto original", type: "currency" },
      { key: "saldo_pendiente", label: "Saldo pendiente", type: "currency" },
    ],
    rowLimitPolicy: { serviceMaxRows: REPORT_ROW_CAP, warningThreshold: REPORT_ROW_CAP },
    summaryCards: (rows) => [
      { label: "Saldo pendiente", value: formatCurrency(sum(rows, "saldo_pendiente")) },
      { label: "Prestamos", value: formatNumber(rows.length) },
      { label: "Activos", value: formatNumber(countBy(rows, "estado", "ACTIVE")) },
      { label: "Pagados", value: formatNumber(countBy(rows, "estado", "PAID")) },
    ],
  },
};

export function getReportDefinition(reportKey: string): ReportDefinition {
  return REPORT_DEFINITIONS[reportKey] ?? {
    reportKey,
    title: reportKey,
    subtitle: "Reporte administrativo",
    description: "Reporte generico",
    orientation: "landscape",
    type: "generic",
    detailLabel: "Detalle",
    columns: [],
  };
}
