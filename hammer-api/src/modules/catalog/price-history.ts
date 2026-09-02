import { PrismaClient, Prisma } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * "Historial de precio, como el del WAC" — Parte B.3. a2ef61d construyó la
 * RECONSTRUCCIÓN del costo promedio a partir de movimientos (no hay una
 * tabla de "historial de costo"). El precio es más simple: cada escritura
 * YA deja un auditLog PRODUCT_PRICE_CHANGED (Parte B.1) con antes/después
 * — no hace falta reconstruir nada, solo leerlo.
 */
export type PriceHistoryRow = {
  id: string;
  occurredAt: Date;
  field: "standardSalePrice" | "branchPrice";
  branchId: string | null;
  previousPrice: number | null;
  newPrice: number | null;
  origin: string | null;
  actorUserId: string | null;
  actorName: string | null;
  /** Si esta escritura vino de la propagación de otro producto (hoy: ninguna — la Parte A la eliminó — pero el campo queda listo si algo la reintroduce). */
  propagatedFromProductId: string | null;
  propagatedFromSku: string | null;
};

export async function getProductPriceHistory(db: DbClient, input: { productId: string }): Promise<PriceHistoryRow[]> {
  const logs = await db.auditLog.findMany({
    where: { action: "PRODUCT_PRICE_CHANGED", entityId: input.productId },
    orderBy: { occurredAt: "asc" },
  });

  const userIds = [...new Set(logs.map((l) => l.actorUserId).filter((id): id is string => !!id))];
  const actors = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, fullName: true } })
    : [];
  const actorNameById = new Map(actors.map((a) => [a.id, a.fullName || a.username]));

  return logs.map((log) => {
    const meta = (log.metadataJson ?? {}) as Record<string, unknown>;
    return {
      id: log.id,
      occurredAt: log.occurredAt,
      field: meta.field === "branchPrice" ? "branchPrice" : "standardSalePrice",
      branchId: (meta.branchId as string | null) ?? log.branchId ?? null,
      previousPrice: typeof meta.previousPrice === "number" ? meta.previousPrice : null,
      newPrice: typeof meta.newPrice === "number" ? meta.newPrice : null,
      origin: typeof meta.origin === "string" ? meta.origin : null,
      actorUserId: log.actorUserId,
      actorName: log.actorUserId ? actorNameById.get(log.actorUserId) ?? null : null,
      propagatedFromProductId: typeof meta.propagatedFromProductId === "string" ? meta.propagatedFromProductId : null,
      propagatedFromSku: typeof meta.propagatedFromSku === "string" ? meta.propagatedFromSku : null,
    };
  });
}
