/**
 * GET /api/master/history
 * Historial unificado maestro: ventas, pagos, producción.
 * Query params: search, branchId, startDate, endDate, type (sale|payment|production), page, limit
 */
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type HistoryEntry = {
  id: string;
  type: "sale" | "payment" | "production";
  date: string;
  reference: string;
  branchName: string;
  branchCode: string;
  description: string;
  amount: number;
  status: string;
  user: string;
};

function formatActor(user: { fullName?: string | null; username?: string | null } | null | undefined) {
  if (!user) return "sistema";
  const fullName = user.fullName?.trim();
  const username = user.username?.trim();
  if (fullName && username) return `${fullName} (usuario: ${username})`;
  return fullName || username || "sistema";
}

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? "";
    const branchId = url.searchParams.get("branchId");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const typeFilter = url.searchParams.get("type"); // sale | payment | production
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "30")));

    const entries: HistoryEntry[] = [];

    // ─── Sales ──────────────────────────────────────────
    if (!typeFilter || typeFilter === "sale") {
      const salesWhere: Prisma.SaleOrderWhereInput = {};
      if (branchId) salesWhere.branchId = branchId;
      if (startDate || endDate) {
        salesWhere.createdAt = {};
        if (startDate) salesWhere.createdAt.gte = new Date(startDate);
        if (endDate) salesWhere.createdAt.lte = new Date(endDate);
      }
      if (search) {
        salesWhere.OR = [
          { orderNumber: { contains: search, mode: "insensitive" } },
          { deliveryOrderNumber: { contains: search, mode: "insensitive" } },
          { customer: { displayName: { contains: search, mode: "insensitive" } } },
        ];
      }

      const sales = await prisma.saleOrder.findMany({
        where: salesWhere,
        include: {
          branch: { select: { name: true, code: true } },
          createdBy: { select: { fullName: true, username: true } },
          customer: { select: { displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: (page - 1) * limit,
      });

      for (const s of sales) {
        entries.push({
          id: s.id,
          type: "sale",
          date: s.createdAt.toISOString(),
          reference: s.deliveryOrderNumber ?? s.orderNumber,
          branchName: s.branch.name,
          branchCode: s.branch.code,
          description: s.customer?.displayName ? `Venta a ${s.customer.displayName}` : `Venta ${s.orderNumber}`,
          amount: Number(s.grandTotal),
          status: s.status,
          user: formatActor(s.createdBy),
        });
      }
    }

    // ─── Payments ───────────────────────────────────────
    if (!typeFilter || typeFilter === "payment") {
      const paymentWhere: Prisma.PaymentWhereInput = {};
      if (branchId) paymentWhere.saleOrder = { branchId };
      if (startDate || endDate) {
        paymentWhere.createdAt = {};
        if (startDate) paymentWhere.createdAt.gte = new Date(startDate);
        if (endDate) paymentWhere.createdAt.lte = new Date(endDate);
      }
      if (search) {
        paymentWhere.OR = [
          { referenceNumber: { contains: search, mode: "insensitive" } },
          { saleOrder: { orderNumber: { contains: search, mode: "insensitive" } } },
        ];
      }

      const payments = await prisma.payment.findMany({
        where: paymentWhere,
        include: {
          saleOrder: {
            select: {
              orderNumber: true,
              branch: { select: { name: true, code: true } },
            },
          },
          receivedBy: { select: { fullName: true, username: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: (page - 1) * limit,
      });

      for (const p of payments) {
        entries.push({
          id: p.id,
          type: "payment",
          date: p.createdAt.toISOString(),
          reference: p.referenceNumber ?? p.saleOrder.orderNumber,
          branchName: p.saleOrder.branch.name,
          branchCode: p.saleOrder.branch.code,
          description: `Pago ${p.method} - Orden ${p.saleOrder.orderNumber}`,
          amount: Number(p.amount),
          status: p.status,
          user: formatActor(p.receivedBy),
        });
      }
    }

    // ─── Production ─────────────────────────────────────
    if (!typeFilter || typeFilter === "production") {
      const prodWhere: Prisma.ProductionBatchWhereInput = {};
      if (branchId) prodWhere.branchId = branchId;
      if (startDate || endDate) {
        prodWhere.createdAt = {};
        if (startDate) prodWhere.createdAt.gte = new Date(startDate);
        if (endDate) prodWhere.createdAt.lte = new Date(endDate);
      }
      if (search) {
        prodWhere.OR = [
          { batchNumber: { contains: search, mode: "insensitive" } },
          { recipe: { name: { contains: search, mode: "insensitive" } } },
        ];
      }

      const batches = await prisma.productionBatch.findMany({
        where: prodWhere,
        include: {
          branch: { select: { name: true, code: true } },
          recipe: { select: { name: true } },
          createdBy: { select: { fullName: true, username: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: (page - 1) * limit,
      });

      for (const b of batches) {
        entries.push({
          id: b.id,
          type: "production",
          date: b.createdAt.toISOString(),
          reference: b.batchNumber,
          branchName: b.branch.name,
          branchCode: b.branch.code,
          description: `Producción: ${b.recipe.name}`,
          amount: Number(b.totalCost),
          status: b.status,
          user: formatActor(b.createdBy),
        });
      }
    }

    // Sort all entries by date desc
    entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return ok({
      entries: entries.slice(0, limit),
      page,
      limit,
    });
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
