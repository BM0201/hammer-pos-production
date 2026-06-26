import { ApprovalStatus, PaymentMethod, PaymentStatus, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { excludeDerivedStockGroupMembers } from "@/modules/catalog/service";

type ReportFilters = {
  branchIds?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  status?: string;
  actorUsername?: string;
};

function dateWhere(filters: ReportFilters, field: "createdAt" | "paidAt" | "occurredAt" | "dispatchedAt") {
  if (!filters.dateFrom && !filters.dateTo) return {};
  return {
    [field]: {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
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

export async function getSalesReportRows(filters: ReportFilters) {
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
    take: 2000,
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
    take: 2000,
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

export async function getPaymentsReportRows(filters: ReportFilters) {
  const rows = await prisma.payment.findMany({
    where: {
      saleOrder: { ...branchWhere(filters) },
      ...dateWhere(filters, "paidAt"),
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.actorUsername ? { receivedBy: { username: { contains: filters.actorUsername } } } : {}),
    },
    include: {
      saleOrder: { select: { orderNumber: true, branch: { select: { code: true, name: true } } } },
      receivedBy: { select: { username: true, fullName: true } },
      tenders: { select: { method: true, amount: true, changeAmount: true, referenceNumber: true } },
    },
    orderBy: { paidAt: "desc" },
    take: 2000,
  });

  return rows.map((row) => {
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
    take: 2000,
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
    take: 2000,
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

export async function getAuditReportRows(filters: ReportFilters) {
  const rows = await prisma.auditLog.findMany({
    where: {
      ...branchWhere(filters),
      ...dateWhere(filters, "occurredAt"),
      ...(filters.status ? { action: { contains: filters.status } } : {}),
      ...(filters.actorUsername ? { actor: { username: { contains: filters.actorUsername } } } : {}),
    },
    include: {
      branch: { select: { code: true, name: true } },
      actor: { select: { username: true, fullName: true } },
    },
    orderBy: { occurredAt: "desc" },
    take: 3000,
  });

  return rows.map((row) => ({
    fecha: row.occurredAt.toISOString(),
    sucursal_codigo: row.branch?.code ?? "",
    sucursal_nombre: row.branch?.name ?? "",
    modulo: row.module,
    accion: row.action,
    usuario: formatActor(row.actor),
    entidad: row.entityType,
    entidad_id: row.entityId,
  }));
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
    take: 2000,
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
                ...(filters.dateTo ? { lte: filters.dateTo } : {}),
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
    take: 2000,
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
              ...(filters.dateTo ? { lte: filters.dateTo } : {}),
            },
          }
        : {}),
    },
    include: {
      employee: { select: { fullName: true } },
      branch: { select: { code: true, name: true } },
    },
    orderBy: { issuedAt: "desc" },
    take: 2000,
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
