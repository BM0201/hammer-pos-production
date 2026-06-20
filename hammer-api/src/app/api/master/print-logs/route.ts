/**
 * GET /api/master/print-logs
 * Listado de logs de impresión con filtros para auditoría.
 * Query params: branchId, documentType, startDate, endDate, page, limit
 */
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import type { Prisma, DocumentType } from "@prisma/client";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId");
    const documentType = url.searchParams.get("documentType") as DocumentType | null;
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));

    const where: Prisma.DocumentPrintLogWhereInput = {};

    if (documentType) where.documentType = documentType;
    if (startDate) where.printedAt = { ...((where.printedAt as object) ?? {}), gte: new Date(startDate) };
    if (endDate) where.printedAt = { ...((where.printedAt as object) ?? {}), lte: new Date(endDate) };
    if (branchId) {
      where.saleOrder = { branchId };
    }

    const [logs, total] = await Promise.all([
      prisma.documentPrintLog.findMany({
        where,
        include: {
          printedBy: { select: { id: true, fullName: true, username: true } },
          saleOrder: {
            select: {
              id: true,
              orderNumber: true,
              deliveryOrderNumber: true,
              branchId: true,
              branch: { select: { name: true, code: true } },
              grandTotal: true,
            },
          },
        },
        orderBy: { printedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.documentPrintLog.count({ where }),
    ]);

    return ok({
      logs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
