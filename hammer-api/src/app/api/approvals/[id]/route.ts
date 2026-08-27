import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { approvalService, assertNoSelfApproval } from "@/modules/approvals/service";
import { resolveApprovalSchema } from "@/modules/approvals/validators";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { isMaster } from "@/modules/rbac/guards";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { logAuditEvent } from "@/modules/audit/service";
import {
  approveSaleCancellation,
  approveSaleReturn,
  rejectSaleCancellation,
  rejectSaleReturn,
} from "@/modules/sales-returns/service";
import { markOrderDispatched } from "@/modules/dispatch/service";
import { createInventoryMovement, listInventoryBalances, resolveStockAdjustmentMovement } from "@/modules/inventory/service";
import { executeApprovedRetainedCashExpense } from "@/modules/treasury/service";
import { applyApprovedPriceOverride } from "@/modules/pricing/branch-band-service";

// Auditoría 2026-07-22, hallazgos C2+C3: la cola genérica solo actualizaba
// ApprovalRequest.status — nunca ejecutaba la acción real (ajuste de
// inventario, override de despacho) ni respetaba el flujo especializado de
// Devoluciones/Cancelaciones (que tienen su propio estado real y ya se
// desincronizaban si se resolvían desde aquí). Esta ruta ahora ramifica por
// referenceType y delega/ejecuta la acción de negocio correspondiente.
async function denySelfReview(request: { requestedByUserId: string; branchId: string; id: string }, actorUserId: string) {
  try {
    assertNoSelfApproval(request.requestedByUserId, actorUserId);
  } catch (error) {
    await logAuditEvent({
      actorUserId,
      branchId: request.branchId,
      module: "approvals",
      action: "APPROVAL_SELF_REVIEW_DENIED",
      entityType: "ApprovalRequest",
      entityId: request.id,
      metadataJson: { reason: "SELF_APPROVAL_BLOCKED" },
    });
    throw error;
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    if (!canInAnyAssignedBranch(session, CAPABILITIES.APPROVAL_REQUEST_REVIEW)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const { id } = await context.params;
    const parsed = resolveApprovalSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    const approval = await approvalService.getRequestById(id);
    if (!approval) {
      return fail("NOT_FOUND", "Not found", 404);
    }

    if (!isMaster(session) && !canInBranch(session, approval.branchId, CAPABILITIES.APPROVAL_REQUEST_REVIEW)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const actor = { userId: session.userId, roleCode: session.roleCode, globalRoles: session.globalRoles as string[] };
    const fallbackReason = (parsed.data.resolutionNotes?.trim() && parsed.data.resolutionNotes.trim().length >= 3)
      ? parsed.data.resolutionNotes.trim()
      : "Resuelto desde la cola de aprobaciones.";

    let data: { requestId: string; status: string };

    if (approval.referenceType === "SaleReturn") {
      await denySelfReview(approval, session.userId);
      if (parsed.data.decision === "APPROVE") {
        await approveSaleReturn(approval.referenceId, actor);
        data = { requestId: id, status: "APPROVED" };
      } else {
        await rejectSaleReturn(approval.referenceId, fallbackReason, actor);
        data = { requestId: id, status: "REJECTED" };
      }
    } else if (approval.referenceType === "SaleCancellation") {
      await denySelfReview(approval, session.userId);
      if (parsed.data.decision === "APPROVE") {
        await approveSaleCancellation(approval.referenceId, actor);
        data = { requestId: id, status: "APPROVED" };
      } else {
        await rejectSaleCancellation(approval.referenceId, fallbackReason, actor);
        data = { requestId: id, status: "REJECTED" };
      }
    } else if (approval.referenceType === "STOCK_ADJUSTMENT") {
      // Resuelve primero (valida self-review/estado ya resuelto); solo si
      // queda APPROVED se ejecuta el ajuste real de inventario.
      const resolved = await approvalService.resolveRequest({
        requestId: id,
        actorUserId: session.userId,
        decision: parsed.data.decision,
        resolutionNotes: parsed.data.resolutionNotes,
      });
      data = resolved;
      if (parsed.data.decision === "APPROVE") {
        try {
          const payload = approval.payloadJson as { desiredQuantity?: number } | null;
          const desiredQuantity = Number(payload?.desiredQuantity ?? NaN);
          if (Number.isFinite(desiredQuantity)) {
            // Se recalcula contra el stock ACTUAL (no el snapshot guardado al
            // solicitar) — el inventario pudo moverse entre la solicitud y la
            // aprobación (otra venta, otro ajuste, una recepción de compra).
            const balances = await listInventoryBalances({ branchId: approval.branchId, productId: approval.referenceId });
            const currentQuantity = Number(balances[0]?.quantityOnHand ?? 0);
            const movement = resolveStockAdjustmentMovement(desiredQuantity, currentQuantity);
            if (movement) {
              const unitCost = Number(balances[0]?.weightedAverageCost ?? 0);
              await createInventoryMovement({
                actorUserId: session.userId,
                branchId: approval.branchId,
                productId: approval.referenceId,
                movementType: movement.movementType,
                quantity: movement.quantity,
                unitCost,
                referenceType: "STOCK_ADJUSTMENT_APPROVED",
                referenceId: approval.id,
                notes: fallbackReason,
              });
            }
          }
        } catch (executionError) {
          await logAuditEvent({
            actorUserId: session.userId,
            branchId: approval.branchId,
            module: "approvals",
            action: "STOCK_ADJUSTMENT_EXECUTION_FAILED",
            entityType: "ApprovalRequest",
            entityId: approval.id,
            metadataJson: {
              productId: approval.referenceId,
              reason: executionError instanceof Error ? executionError.message : "UNKNOWN",
            },
          });
          throw executionError;
        }
      }
    } else if (approval.referenceType === "DISPATCH_OVERRIDE") {
      const resolved = await approvalService.resolveRequest({
        requestId: id,
        actorUserId: session.userId,
        decision: parsed.data.decision,
        resolutionNotes: parsed.data.resolutionNotes,
      });
      data = resolved;
      if (parsed.data.decision === "APPROVE") {
        try {
          await markOrderDispatched({
            orderId: approval.referenceId,
            actorUserId: session.userId,
            notes: fallbackReason,
            force: true,
          });
        } catch (executionError) {
          await logAuditEvent({
            actorUserId: session.userId,
            branchId: approval.branchId,
            module: "approvals",
            action: "DISPATCH_OVERRIDE_EXECUTION_FAILED",
            entityType: "ApprovalRequest",
            entityId: approval.id,
            metadataJson: {
              orderId: approval.referenceId,
              reason: executionError instanceof Error ? executionError.message : "UNKNOWN",
            },
          });
          throw executionError;
        }
      }
    } else if (approval.referenceType === "RETAINED_CASH_EXPENSE") {
      const resolved = await approvalService.resolveRequest({
        requestId: id,
        actorUserId: session.userId,
        decision: parsed.data.decision,
        resolutionNotes: parsed.data.resolutionNotes,
      });
      data = resolved;
      if (parsed.data.decision === "APPROVE") {
        try {
          const payload = approval.payloadJson as {
            branchId: string; category: string; description: string; amount: number; receiptReference: string; safeAccountId: string;
          } | null;
          if (!payload) throw new Error("RETAINED_CASH_EXPENSE_PAYLOAD_MISSING");
          await executeApprovedRetainedCashExpense({
            actorUserId: session.userId,
            payload: payload as Parameters<typeof executeApprovedRetainedCashExpense>[0]["payload"],
          });
        } catch (executionError) {
          await logAuditEvent({
            actorUserId: session.userId,
            branchId: approval.branchId,
            module: "approvals",
            action: "RETAINED_CASH_EXPENSE_EXECUTION_FAILED",
            entityType: "ApprovalRequest",
            entityId: approval.id,
            metadataJson: {
              reason: executionError instanceof Error ? executionError.message : "UNKNOWN",
            },
          });
          throw executionError;
        }
      }
    } else if (approval.referenceType === "PRICE_OVERRIDE") {
      // Fase 4 (prompt-motor-precios-lote-herencia-gobierno.md) — aprobar
      // ejecuta el precio pedido; rechazar deja el precio como estaba (la
      // solicitud nunca tocó nada hasta este momento).
      const resolved = await approvalService.resolveRequest({
        requestId: id,
        actorUserId: session.userId,
        decision: parsed.data.decision,
        resolutionNotes: parsed.data.resolutionNotes,
      });
      data = resolved;
      if (parsed.data.decision === "APPROVE") {
        try {
          await applyApprovedPriceOverride({ payloadJson: approval.payloadJson, actorUserId: session.userId, requestId: id });
        } catch (executionError) {
          await logAuditEvent({
            actorUserId: session.userId,
            branchId: approval.branchId,
            module: "approvals",
            action: "PRICE_OVERRIDE_EXECUTION_FAILED",
            entityType: "ApprovalRequest",
            entityId: approval.id,
            metadataJson: {
              productId: approval.referenceId,
              reason: executionError instanceof Error ? executionError.message : "UNKNOWN",
            },
          });
          throw executionError;
        }
      }
    } else {
      // Tipos sin acción real conocida (ej. históricos CASH_SESSION_DISCREPANCY,
      // o tipos declarados en el enum pero aún sin flujo de creación real).
      data = await approvalService.resolveRequest({
        requestId: id,
        actorUserId: session.userId,
        decision: parsed.data.decision,
        resolutionNotes: parsed.data.resolutionNotes,
      });
    }

    return ok(data);
  } catch (error) {
    if (error instanceof Error && error.message === "APPROVAL_SELF_REVIEW_FORBIDDEN") {
      return fail("FORBIDDEN", "No puedes aprobar o rechazar una solicitud creada por ti mismo.", 403);
    }
    if (error instanceof Error && error.message === "APPROVAL_ALREADY_RESOLVED") {
      return fail("CONFLICT", error.message, 409);
    }
    if (error instanceof Error && (
      error.message === "SALE_RETURN_NOT_REQUESTED"
      || error.message === "SALE_CANCELLATION_NOT_REQUESTED"
    )) {
      return fail("CONFLICT", "Esta solicitud ya fue resuelta o ejecutada.", 409);
    }
    if (error instanceof Error && error.message === "DISPATCH_ORDER_CANCELLED") {
      return fail("CONFLICT", "La orden fue cancelada — ya no puede despacharse.", 409);
    }
    return toHttpErrorResponse(error);
  }
}
