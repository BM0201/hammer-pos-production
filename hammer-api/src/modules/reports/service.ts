import { ApprovalStatus, PaymentMethod, PaymentStatus, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { excludeDerivedStockGroupMembers } from "@/modules/catalog/service";
import { getSalesSummaryAggregated } from "@/modules/reports/sales-analytics";
import { REPORT_ROW_CAP } from "@/modules/reports/report-definitions";
import {
  MOVEMENT_GROUP_LABEL,
  MOVEMENT_TYPES_BY_GROUP,
  resolveMovementGroup,
  signedMovementQuantity,
  type MovementGroup,
} from "@/modules/reports/movement-groups";

type ReportFilters = {
  branchIds?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  status?: string;
  actorUsername?: string;
};

// dateFrom = inicio (inclusive) del día de negocio Managua; dateTo = inicio
// (exclusivo) del día SIGUIENTE en Managua — ver resolveReportRequest
// (reports/http.ts). Por eso el límite superior usa "lt", no "lte".
export function dateWhere(filters: ReportFilters, field: "createdAt" | "paidAt" | "occurredAt" | "dispatchedAt") {
  if (!filters.dateFrom && !filters.dateTo) return {};
  return {
    [field]: {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lt: filters.dateTo } : {}),
    },
  };
}

function branchWhere(filters: ReportFilters, field = "branchId") {
  if (!filters.branchIds?.length) return {};
  return { [field]: { in: filters.branchIds } };
}

function formatActor(user: { fullName?: string | null; username?: string | null } | null | undefined, fallback = "sistema") {
  if (!user) return fallback;
  const fullName = user.fullName?.trim();
  const username = user.username?.trim();
  if (fullName && username) return `${fullName} (usuario: ${username})`;
  return fullName || username || fallback;
}

function fixed2(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

// Fuente considerada "estándar" para el costo de una línea de venta — ver
// getEffectiveProductPricing (catalog/effective-pricing.ts): BRANCH es la
// primera prioridad real en el código (costo manual de la sucursal); las
// demás (GLOBAL_AVERAGE/GLOBAL/LAST_PURCHASE/WAC_ESTIMATE) son fallbacks que
// se usan cuando ese dato no existía al momento de la venta. Se anota para
// trazabilidad, no para recalcular nada.
const STANDARD_COST_SOURCE = "BRANCH";

// CAMBIO 1 (prompt-reportes-v2): antes este reporte consultaba Payment y solo
// mostraba fecha/orden/vendedor/total — no decía QUÉ se vendió. Ahora baja a
// SaleOrderLine (mismo patrón que getDiscountsReportRows) y expone producto,
// categoría, costo y margen leídos de los snapshots de la línea (costSnapshot/
// marginSnapshot/marginPercentSnapshot), nunca recalculados con el WAC actual.
export async function getSalesReportRows(filters: ReportFilters) {
  const where = {
    saleOrder: {
      ...branchWhere(filters),
      status: filters.status ? (filters.status as SaleOrderStatus) : { not: SaleOrderStatus.CANCELLED },
      // La fecha de referencia sigue siendo la de cobro (paidAt), como en el
      // reporte original — una línea solo entra al reporte si su orden tiene
      // un pago POSTED dentro del rango.
      payments: { some: { status: PaymentStatus.POSTED, ...dateWhere(filters, "paidAt") } },
    },
  };

  // CAMBIO 5 (prompt-reportes-v2): total REAL del rango (sin el tope), para
  // que el aviso de límite sea honesto ("N de M"), nunca un truncado en
  // silencio cuando un rango largo supera REPORT_ROW_CAP.
  const [rows, totalCount] = await Promise.all([
    prisma.saleOrderLine.findMany({
      where,
      include: {
        product: { select: { sku: true, name: true, category: { select: { name: true } } } },
        saleOrder: {
          select: {
            orderNumber: true,
            branch: { select: { code: true, name: true } },
            createdBy: { select: { username: true, fullName: true } },
            payments: { where: { status: PaymentStatus.POSTED }, select: { paidAt: true }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: REPORT_ROW_CAP,
    }),
    prisma.saleOrderLine.count({ where }),
  ]);

  const mapped = rows.map((row) => {
    const quantity = Number(row.quantity);
    const unitCost = row.costSnapshot != null ? Number(row.costSnapshot) : null;
    const marginAmount = row.marginSnapshot != null ? Number(row.marginSnapshot) : null;
    const marginPercent = row.marginPercentSnapshot != null ? Number(row.marginPercentSnapshot) : null;
    const paidAt = row.saleOrder.payments[0]?.paidAt ?? row.createdAt;
    const isStandardCostSource = !row.costSourceSnapshot || row.costSourceSnapshot === STANDARD_COST_SOURCE;

    return {
      fecha: paidAt.toISOString(),
      sucursal_codigo: row.saleOrder.branch.code,
      sucursal_nombre: row.saleOrder.branch.name,
      orden: row.saleOrder.orderNumber,
      producto_sku: row.product.sku,
      producto_nombre: row.product.name,
      categoria: row.product.category?.name ?? "Sin categoría",
      cantidad: row.quantity.toString(),
      precio_unitario: fixed2(Number(row.unitPrice)),
      costo_unitario: unitCost != null ? fixed2(unitCost) : "",
      costo_total: unitCost != null ? fixed2(unitCost * quantity) : "",
      subtotal: fixed2(Number(row.lineSubtotal)),
      margen_monto: marginAmount != null ? fixed2(marginAmount) : "",
      margen_porcentaje: marginPercent != null ? fixed2(marginPercent) : "",
      costo_fuente: isStandardCostSource ? "" : (row.costSourceSnapshot ?? ""),
      vendedor: formatActor(row.saleOrder.createdBy),
    };
  });

  return { rows: mapped, totalCount };
}

// Vista "resumen por orden" — el comportamiento ORIGINAL de getSalesReportRows
// (una fila por orden/pago, sin detalle de producto). Se conserva tal cual
// para quien prefiera esa vista (prompt-reportes-v2 CAMBIO 1: "conservar...
// como opción además de detalle por línea y por categoría").
export async function getSalesSummaryByOrderRows(filters: ReportFilters) {
  const rows = await prisma.payment.findMany({
    where: {
      status: PaymentStatus.POSTED,
      ...dateWhere(filters, "paidAt"),
      saleOrder: {
        ...branchWhere(filters),
        status: filters.status ? (filters.status as SaleOrderStatus) : { not: SaleOrderStatus.CANCELLED },
      },
    },
    include: {
      saleOrder: {
        select: {
          orderNumber: true,
          status: true,
          branch: { select: { code: true, name: true } },
          createdBy: { select: { username: true, fullName: true } },
        },
      },
    },
    orderBy: { paidAt: "desc" },
    take: REPORT_ROW_CAP,
  });

  return rows.map((row) => ({
    fecha: row.paidAt.toISOString(),
    sucursal_codigo: row.saleOrder.branch.code,
    sucursal_nombre: row.saleOrder.branch.name,
    orden: row.saleOrder.orderNumber,
    estado: row.saleOrder.status,
    vendedor: formatActor(row.saleOrder.createdBy),
    total: row.amount.toString(),
  }));
}

// CAMBIO 2 (prompt-reportes-v2): "Ventas por categoría" — NO es una query
// paralela. Reusa getSalesSummaryAggregated (sales-analytics.ts), que ya hace
// el JOIN a Category y agrega costo/margen por categoría; esta función solo
// reformatea byCategory como filas de reporte exportables (PDF/CSV/Excel).
export async function getSalesByCategoryReportRows(filters: ReportFilters) {
  const { byCategory } = await getSalesSummaryAggregated({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    branchIds: filters.branchIds,
  });

  const totalSold = byCategory.reduce((sum, row) => sum + row.total_sold, 0);

  return byCategory.map((row) => {
    const marginPercent = row.total_sold > 0 ? (row.total_margin / row.total_sold) * 100 : 0;
    const percentOfTotal = totalSold > 0 ? (row.total_sold / totalSold) * 100 : 0;
    return {
      categoria: row.category_name,
      ingreso: fixed2(row.total_sold),
      costo: fixed2(row.total_cost),
      margen_porcentaje: fixed2(marginPercent),
      porcentaje_total: fixed2(percentOfTotal),
      ordenes: String(row.orders_count),
    };
  });
}

export async function getDiscountsReportRows(filters: ReportFilters) {
  const rows = await prisma.saleOrderLine.findMany({
    where: {
      discountAmount: { gt: 0 },
      ...dateWhere(filters, "createdAt"),
      saleOrder: {
        ...branchWhere(filters),
      },
    },
    include: {
      product: { select: { sku: true, name: true } },
      saleOrder: {
        select: {
          orderNumber: true,
          branch: { select: { code: true, name: true } },
          createdBy: { select: { username: true, fullName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: REPORT_ROW_CAP,
  });

  return rows.map((row) => {
    const quantity = Number(row.quantity);
    const unitPrice = Number(row.unitPrice);
    const gross = quantity * unitPrice;
    const discount = Number(row.discountAmount);
    const effectivePercent = gross > 0 ? (discount / gross) * 100 : 0;

    return {
      fecha: row.createdAt.toISOString(),
      sucursal_codigo: row.saleOrder.branch.code,
      sucursal_nombre: row.saleOrder.branch.name,
      orden: row.saleOrder.orderNumber,
      producto_sku: row.product.sku,
      producto_nombre: row.product.name,
      cantidad: row.quantity.toString(),
      precio_unitario: fixed2(unitPrice),
      subtotal_bruto: fixed2(gross),
      descuento_monto: fixed2(discount),
      descuento_porcentaje_efectivo: fixed2(effectivePercent),
      subtotal_final: fixed2(Number(row.lineSubtotal)),
      vendedor: formatActor(row.saleOrder.createdBy),
    };
  });
}

// CAMBIO 5: total real via count() — este reporte alimenta la sección
// "Cobros y métodos de pago" del documento de auditoría multi-mes.
export async function getPaymentsReportRows(filters: ReportFilters) {
  const where = {
    saleOrder: { ...branchWhere(filters) },
    ...dateWhere(filters, "paidAt"),
    ...(filters.status ? { status: filters.status as never } : {}),
    ...(filters.actorUsername ? { receivedBy: { username: { contains: filters.actorUsername } } } : {}),
  };

  const [rows, totalCount] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        saleOrder: { select: { orderNumber: true, branch: { select: { code: true, name: true } } } },
        receivedBy: { select: { username: true, fullName: true } },
        tenders: { select: { method: true, amount: true, changeAmount: true, referenceNumber: true } },
      },
      orderBy: { paidAt: "desc" },
      take: REPORT_ROW_CAP,
    }),
    prisma.payment.count({ where }),
  ]);

  const mapped = rows.map((row) => {
    const cashTender = row.tenders
      .filter((tender) => tender.method === PaymentMethod.CASH)
      .reduce((sum, tender) => sum + Number(tender.amount), 0);
    const cashChange = row.tenders.reduce((sum, tender) => sum + Number(tender.changeAmount ?? 0), 0);
    return {
      fecha_pago: row.paidAt.toISOString(),
      sucursal_codigo: row.saleOrder.branch.code,
      sucursal_nombre: row.saleOrder.branch.name,
      orden: row.saleOrder.orderNumber,
      metodo: row.method,
      tenders: row.tenders.map((tender) => `${tender.method}:${fixed2(Number(tender.amount))}`).join(" | "),
      estado: row.status,
      cajero: formatActor(row.receivedBy),
      monto: row.amount.toString(),
      efectivo: fixed2(cashTender),
      cambio: fixed2(cashChange),
      referencia: row.referenceNumber ?? row.tenders.map((tender) => tender.referenceNumber).filter(Boolean).join(" | "),
    };
  });

  return { rows: mapped, totalCount };
}

export async function getDispatchReportRows(filters: ReportFilters) {
  const rows = await prisma.dispatchTicket.findMany({
    where: {
      ...branchWhere(filters),
      ...dateWhere(filters, "createdAt"),
      ...(filters.status ? { status: filters.status as never } : {}),
    },
    include: {
      branch: { select: { code: true, name: true } },
      saleOrder: { select: { orderNumber: true } },
      processedBy: { select: { username: true, fullName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: REPORT_ROW_CAP,
  });

  return rows.map((row) => ({
    fecha: row.createdAt.toISOString(),
    sucursal_codigo: row.branch.code,
    sucursal_nombre: row.branch.name,
    orden: row.saleOrder.orderNumber,
    estado: row.status,
    despachado_por: formatActor(row.processedBy, ""),
    fecha_despacho: row.dispatchedAt?.toISOString() ?? "",
    notas: row.notes ?? "",
  }));
}

export async function getApprovalsReportRows(filters: ReportFilters) {
  const rows = await prisma.approvalRequest.findMany({
    where: {
      ...branchWhere(filters),
      ...dateWhere(filters, "createdAt"),
      ...(filters.status ? { status: filters.status as ApprovalStatus } : {}),
      ...(filters.actorUsername ? { requestedBy: { username: { contains: filters.actorUsername } } } : {}),
    },
    include: {
      branch: { select: { code: true, name: true } },
      requestedBy: { select: { username: true, fullName: true } },
      resolvedBy: { select: { username: true, fullName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: REPORT_ROW_CAP,
  });

  return rows.map((row) => ({
    fecha_solicitud: row.createdAt.toISOString(),
    sucursal_codigo: row.branch.code,
    sucursal_nombre: row.branch.name,
    tipo: row.type,
    estado: row.status,
    solicitado_por: formatActor(row.requestedBy),
    resuelto_por: formatActor(row.resolvedBy, ""),
    referencia_tipo: row.referenceType,
    referencia_id: row.referenceId,
    motivo: row.reason,
  }));
}

// CAMBIO 5: total real via count() — es el reporte de auditoría en sí, el
// más directamente apuntado por "cero take truncando exports de auditoría".
export async function getAuditReportRows(filters: ReportFilters) {
  const where = {
    ...branchWhere(filters),
    ...dateWhere(filters, "occurredAt"),
    ...(filters.status ? { action: { contains: filters.status } } : {}),
    ...(filters.actorUsername ? { actor: { username: { contains: filters.actorUsername } } } : {}),
  };

  const [rows, totalCount] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        branch: { select: { code: true, name: true } },
        actor: { select: { username: true, fullName: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: REPORT_ROW_CAP,
    }),
    prisma.auditLog.count({ where }),
  ]);

  const mapped = rows.map((row) => ({
    fecha: row.occurredAt.toISOString(),
    sucursal_codigo: row.branch?.code ?? "",
    sucursal_nombre: row.branch?.name ?? "",
    modulo: row.module,
    accion: row.action,
    usuario: formatActor(row.actor),
    entidad: row.entityType,
    entidad_id: row.entityId,
  }));

  return { rows: mapped, totalCount };
}

export async function getInventoryCriticalReportRows(filters: ReportFilters) {
  const rows = await prisma.inventoryBalance.findMany({
    where: {
      ...branchWhere(filters),
      quantityOnHand: { lte: 5 },
      // No alertar por productos derivados de una fusión (su balance está en cero
      // por diseño; el stock real vive en el canónico). Evita falsos críticos.
      product: excludeDerivedStockGroupMembers(),
    },
    include: {
      branch: { select: { code: true, name: true } },
      product: { select: { sku: true, name: true } },
    },
    orderBy: { quantityOnHand: "asc" },
    take: REPORT_ROW_CAP,
  });

  return rows.map((row) => ({
    sucursal_codigo: row.branch.code,
    sucursal_nombre: row.branch.name,
    sku: row.product.sku,
    producto: row.product.name,
    existencia: row.quantityOnHand.toString(),
    costo_promedio: row.weightedAverageCost.toString(),
    valor_inventario: row.inventoryValue.toString(),
  }));
}

// CAMBIO 4 (prompt-reportes-v2): nunca existió un reporte sobre
// InventoryMovement. Clasifica por movementType vía el mapa único de
// movement-groups.ts (nunca hardcodeado acá) y resuelve referenceType/
// referenceId a un número legible con un lote de queries por tipo (evita
// N+1 — nunca una query por fila).
// CAMBIO 5: total real via count() — alimenta las secciones "Ingresos de
// materiales", "Envíos/traslados" y "Conteos y ajustes" del documento de
// auditoría multi-mes (una llamada por grupo).
export async function getInventoryMovementsReportRows(filters: ReportFilters & { group?: MovementGroup }) {
  const groupTypes = filters.group ? MOVEMENT_TYPES_BY_GROUP[filters.group] : undefined;
  const where = {
    ...branchWhere(filters),
    ...dateWhere(filters, "createdAt"),
    ...(groupTypes ? { movementType: { in: groupTypes } } : {}),
  };

  const [rows, totalCount] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      include: {
        branch: { select: { code: true, name: true } },
        product: { select: { sku: true, name: true, category: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: REPORT_ROW_CAP,
    }),
    prisma.inventoryMovement.count({ where }),
  ]);

  const idsByType = (type: string) => [...new Set(rows.filter((r) => r.referenceType === type).map((r) => r.referenceId))];
  const transferIds = idsByType("Transfer");
  const purchaseOrderIds = idsByType("PurchaseOrder");
  const timberTripIds = idsByType("TIMBER_TRIP");
  const productionBatchIds = idsByType("ProductionBatch");
  const saleOrderIds = [...new Set(rows.filter((r) => r.referenceType === "DIRECT_SALE" || r.referenceType === "SALE_CANCELLATION").map((r) => r.referenceId))];
  const saleReturnIds = [...new Set(rows.filter((r) => ["SaleReturn", "SALE_RETURN", "SALE_RETURN_DAMAGED"].includes(r.referenceType)).map((r) => r.referenceId))];

  const [transfers, purchaseOrders, timberTrips, productionBatches, saleOrders, saleReturns] = await Promise.all([
    transferIds.length
      ? prisma.transfer.findMany({ where: { id: { in: transferIds } }, select: { id: true, transferNumber: true, fromBranch: { select: { code: true } }, toBranch: { select: { code: true } } } })
      : Promise.resolve([]),
    purchaseOrderIds.length
      ? prisma.purchaseOrder.findMany({ where: { id: { in: purchaseOrderIds } }, select: { id: true, orderNumber: true } })
      : Promise.resolve([]),
    timberTripIds.length
      ? prisma.timberTrip.findMany({ where: { id: { in: timberTripIds } }, select: { id: true, tripCode: true } })
      : Promise.resolve([]),
    productionBatchIds.length
      ? prisma.productionBatch.findMany({ where: { id: { in: productionBatchIds } }, select: { id: true, batchNumber: true } })
      : Promise.resolve([]),
    saleOrderIds.length
      ? prisma.saleOrder.findMany({ where: { id: { in: saleOrderIds } }, select: { id: true, orderNumber: true } })
      : Promise.resolve([]),
    saleReturnIds.length
      ? prisma.saleReturn.findMany({ where: { id: { in: saleReturnIds } }, select: { id: true, returnNumber: true } })
      : Promise.resolve([]),
  ]);

  const transferMap = new Map(transfers.map((t) => [t.id, t]));
  const purchaseOrderMap = new Map(purchaseOrders.map((p) => [p.id, p.orderNumber]));
  const timberTripMap = new Map(timberTrips.map((t) => [t.id, t.tripCode]));
  const productionBatchMap = new Map(productionBatches.map((b) => [b.id, b.batchNumber]));
  const saleOrderMap = new Map(saleOrders.map((s) => [s.id, s.orderNumber]));
  const saleReturnMap = new Map(saleReturns.map((r) => [r.id, r.returnNumber]));

  const mapped = rows.map((row) => {
    const group = resolveMovementGroup(row.movementType);
    const signedQuantity = signedMovementQuantity(row.movementType, Number(row.quantity));
    const unitCost = Number(row.unitCost);

    let referencia = row.referenceId;
    let origenDestino = "";
    if (row.referenceType === "Transfer") {
      const transfer = transferMap.get(row.referenceId);
      referencia = transfer?.transferNumber ?? row.referenceId;
      // Flecha ASCII (no unicode "→"): el PDF hecho a mano limpia cualquier
      // carácter fuera de ASCII imprimible a "?" (ver cleanPdfText en pdf.ts).
      origenDestino = transfer ? `${transfer.fromBranch.code} -> ${transfer.toBranch.code}` : "";
    } else if (row.referenceType === "PurchaseOrder") {
      referencia = purchaseOrderMap.get(row.referenceId) ?? row.referenceId;
    } else if (row.referenceType === "TIMBER_TRIP") {
      referencia = timberTripMap.get(row.referenceId) ?? row.referenceId;
    } else if (row.referenceType === "ProductionBatch") {
      referencia = productionBatchMap.get(row.referenceId) ?? row.referenceId;
    } else if (row.referenceType === "DIRECT_SALE" || row.referenceType === "SALE_CANCELLATION") {
      referencia = saleOrderMap.get(row.referenceId) ?? row.referenceId;
    } else if (["SaleReturn", "SALE_RETURN", "SALE_RETURN_DAMAGED"].includes(row.referenceType)) {
      referencia = saleReturnMap.get(row.referenceId) ?? row.referenceId;
    }

    return {
      fecha: row.createdAt.toISOString(),
      sucursal_codigo: row.branch.code,
      sucursal_nombre: row.branch.name,
      grupo: MOVEMENT_GROUP_LABEL[group],
      tipo: row.movementType,
      producto_sku: row.product.sku,
      producto_nombre: row.product.name,
      categoria: row.product.category?.name ?? "Sin categoría",
      cantidad: signedQuantity.toString(),
      costo_unitario: fixed2(unitCost),
      valor: fixed2(signedQuantity * unitCost),
      origen_destino: origenDestino,
      referencia,
      motivo: row.reason ?? "",
    };
  });

  return { rows: mapped, totalCount };
}

export async function getPayrollReportRows(filters: ReportFilters) {
  const rows = await prisma.payrollLine.findMany({
    where: {
      employee: {
        ...branchWhere(filters),
      },
      payrollRun: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.dateFrom || filters.dateTo
          ? {
              createdAt: {
                ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
                ...(filters.dateTo ? { lt: filters.dateTo } : {}),
              },
            }
          : {}),
      },
    },
    include: {
      employee: { select: { fullName: true, position: true, branch: { select: { code: true, name: true } } } },
      payrollRun: { include: { branch: { select: { code: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: REPORT_ROW_CAP,
  });

  return rows.map((row) => ({
    ano: row.payrollRun.year,
    mes: row.payrollRun.month,
    sucursal: row.payrollRun.branch
      ? `${row.payrollRun.branch.code} - ${row.payrollRun.branch.name}`
      : `${row.employee.branch.code} - ${row.employee.branch.name}`,
    empleado: row.employee.fullName,
    puesto: row.employee.position,
    salario_bruto: fixed2(Number(row.grossSalary)),
    deducciones_prestamos: fixed2(Number(row.loanDeductions)),
    otras_deducciones: fixed2(Number(row.otherDeductions)),
    neto_a_pagar: fixed2(Number(row.netPay)),
    costo_empresa: fixed2(Number(row.employerCost)),
    estado_run: row.payrollRun.status,
  }));
}

export async function getEmployeeLoansReportRows(filters: ReportFilters) {
  const rows = await prisma.employeeLoan.findMany({
    where: {
      ...branchWhere(filters),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.dateFrom || filters.dateTo
        ? {
            issuedAt: {
              ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
              ...(filters.dateTo ? { lt: filters.dateTo } : {}),
            },
          }
        : {}),
    },
    include: {
      employee: { select: { fullName: true } },
      branch: { select: { code: true, name: true } },
    },
    orderBy: { issuedAt: "desc" },
    take: REPORT_ROW_CAP,
  });

  return rows.map((row) => ({
    fecha: row.issuedAt.toISOString(),
    sucursal: `${row.branch.code} - ${row.branch.name}`,
    empleado: row.employee.fullName,
    monto_original: fixed2(Number(row.principalAmount)),
    saldo_pendiente: fixed2(Number(row.outstandingBalance)),
    cuota: row.installmentAmount ? fixed2(Number(row.installmentAmount)) : "",
    estado: row.status,
    notas: row.notes ?? "",
  }));
}
