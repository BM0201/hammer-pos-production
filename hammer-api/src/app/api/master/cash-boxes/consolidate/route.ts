import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";

/**
 * Consolida las cajas físicas duplicadas dejando UNA sola caja por sucursal.
 *
 * Regla de negocio: una sucursal solo debe tener una caja física. Varios
 * vendedores comparten la misma caja. Históricamente algunas sucursales
 * quedaron con dos cajas (p. ej. Managua con CAJA-01 y CASH-MGA-01) por
 * mezclar el seed antiguo con la creación automática.
 *
 * Para cada sucursal con más de una caja:
 *  1. Se elige la caja "canónica" a conservar:
 *     - preferimos la que sigue la convención CASH-{codigoSucursal}-01,
 *     - si ninguna la cumple, la que tenga más sesiones,
 *     - como último criterio, la más antigua.
 *  2. Se migran todas las sesiones de las cajas duplicadas a la canónica.
 *  3. Se eliminan las cajas duplicadas (ya sin sesiones).
 *
 * Es idempotente: si todas las sucursales ya tienen una sola caja, no hace nada.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const branches = await prisma.branch.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        physicalCashBoxes: {
          select: {
            id: true,
            code: true,
            isActive: true,
            createdAt: true,
            _count: { select: { sessions: true } },
          },
        },
      },
      orderBy: { code: "asc" },
    });

    const consolidations: {
      branchCode: string;
      keptBox: string;
      removedBoxes: string[];
      migratedSessions: number;
      activeKeyRepairs: number;
      warnings: string[];
    }[] = [];

    for (const branch of branches) {
      const boxes = branch.physicalCashBoxes;
      if (boxes.length <= 1) continue;

      const canonicalCode = `CASH-${branch.code}-01`;

      // Elegir la caja a conservar.
      const sortedForKeep = [...boxes].sort((a, b) => {
        // 1) la que sigue la convención de nombre
        const aCanonical = a.code === canonicalCode ? 1 : 0;
        const bCanonical = b.code === canonicalCode ? 1 : 0;
        if (aCanonical !== bCanonical) return bCanonical - aCanonical;
        // 2) la que esté activa
        const aActive = a.isActive ? 1 : 0;
        const bActive = b.isActive ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        // 3) la que tenga más sesiones
        if (a._count.sessions !== b._count.sessions) return b._count.sessions - a._count.sessions;
        // 4) la más antigua
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

      const keep = sortedForKeep[0];
      const duplicates = sortedForKeep.slice(1);

      let migratedSessions = 0;
      let activeKeyRepairs = 0;
      const warnings: string[] = [];

      await prisma.$transaction(async (tx) => {
        for (const dup of duplicates) {
          // Detect OPEN sessions on the duplicate box before migration.
          // If keep already has an OPEN session, migrating another OPEN session
          // would create two OPEN sessions for the same physical box — a hard invariant violation.
          const openOnDup = await tx.cashSession.findMany({
            where: { physicalCashBoxId: dup.id, status: "OPEN" },
            select: { id: true, activeSessionKey: true },
          });
          const openOnKeep = await tx.cashSession.findFirst({
            where: { physicalCashBoxId: keep.id, status: "OPEN" },
            select: { id: true },
          });

          if (openOnDup.length > 0 && openOnKeep) {
            warnings.push(
              `${branch.code}: both dup(${dup.code}) and keep(${keep.code}) have OPEN sessions — skipped activeSessionKey repair to avoid unique constraint violation`,
            );
          }

          // Migrar sesiones de la caja duplicada hacia la caja conservada.
          if (dup._count.sessions > 0) {
            const result = await tx.cashSession.updateMany({
              where: { physicalCashBoxId: dup.id },
              data: { physicalCashBoxId: keep.id },
            });
            migratedSessions += result.count;

            // Repair activeSessionKey for migrated OPEN sessions.
            // After physicalCashBoxId is updated to keep.id, any OPEN session that
            // came from dup still has activeSessionKey = "OPEN:<dup.id>", breaking
            // the invariant activeSessionKey === "OPEN:<physicalCashBoxId>".
            if (openOnDup.length > 0 && !openOnKeep) {
              const repair = await tx.cashSession.updateMany({
                where: {
                  physicalCashBoxId: keep.id,
                  activeSessionKey: `OPEN:${dup.id}`,
                },
                data: { activeSessionKey: `OPEN:${keep.id}` },
              });
              activeKeyRepairs += repair.count;
            }
          }

          // Eliminar la caja duplicada ya sin sesiones.
          await tx.physicalCashBox.delete({ where: { id: dup.id } });
        }

        // Asegurar que la caja conservada quede activa.
        if (!keep.isActive) {
          await tx.physicalCashBox.update({ where: { id: keep.id }, data: { isActive: true } });
        }
      });

      await logAuditEvent({
        actorUserId: session.userId,
        branchId: branch.id,
        module: "cash_session",
        action: "CASH_BOX_CONSOLIDATED",
        entityType: "PhysicalCashBox",
        entityId: keep.id,
        metadataJson: {
          keptBox: keep.code,
          removedBoxes: duplicates.map((d) => d.code),
          migratedSessions,
          activeKeyRepairs,
          warnings,
        },
      });

      consolidations.push({
        branchCode: branch.code,
        keptBox: keep.code,
        removedBoxes: duplicates.map((d) => d.code),
        migratedSessions,
        activeKeyRepairs,
        warnings,
      });
    }

    const totalRemoved = consolidations.reduce((sum, c) => sum + c.removedBoxes.length, 0);

    return ok({
      consolidatedBranches: consolidations.length,
      removedBoxes: totalRemoved,
      details: consolidations,
      message:
        consolidations.length > 0
          ? `Se consolidaron ${consolidations.length} sucursal(es) y se eliminaron ${totalRemoved} caja(s) duplicada(s).`
          : "No hay cajas duplicadas. Cada sucursal ya tiene una sola caja física.",
    });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
