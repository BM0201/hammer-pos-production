"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertCircle, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money, qty, fmtDateTime } from "@/lib/format";
import { IntakeBranchFixSheet, type FixSheetAppliedLine } from "@/components/inventory-intake/intake-branch-fix-sheet";

/**
 * Fase 3 (prompt-entrada-inventario.md) — "Historial de entradas: GET
 * /api/inventory/multi-branch-intake (ya existe)... y una pestaña o sección
 * 'Entradas' en Movimientos, con el detalle de solo lectura." Autónomo: la
 * respuesta ya trae todo lo que hace falta (código de sucursal, nombre de
 * quien la creó, detalle de línea con sku/nombre) — no necesita props del
 * panel que lo monta.
 */

const INTAKE_KIND_LABELS: Record<string, string> = {
  ADD_STOCK: "Sumar",
  ADJUSTMENT_IN: "Sumar",
  PHYSICAL_COUNT: "Conteo",
  OPENING_BALANCE: "Carga inicial",
};

const BRANCH_STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  DONE: "success",
  IN_PROGRESS: "warning",
  PENDING: "neutral",
  FAILED: "danger",
  DISCARDED: "neutral",
};
const BRANCH_STATUS_LABEL: Record<string, string> = {
  DONE: "Hecho",
  IN_PROGRESS: "En curso",
  PENDING: "Pendiente",
  FAILED: "Falló",
  DISCARDED: "Descartada",
};

type IntakeListItem = {
  id: string;
  code: string;
  kind: string;
  reason: string;
  notes: string | null;
  createdAt: string;
  createdBy: { fullName: string } | null;
  branches: Array<{ branchId: string; status: string; branch: { code: string } }>;
};

type IntakeLineDetail = {
  productId: string;
  quantity: number;
  overrides?: Record<string, number>;
  unitCost?: number;
  salePrice?: number;
  unit?: string;
  product: { id: string; sku: string; name: string } | null;
};

/** prompt-entrada-reintento-precio.md Commit 1 §3 — misma forma que IntakeErrorJson del backend (intake-error-messages.ts). */
type IntakeErrorJson = { summary: string; lines: Array<{ productId: string; sku: string; name: string; code: string; text: string }> };

type IntakeDetailBranch = {
  branchId: string;
  status: string;
  error: string | null;
  errorJson: IntakeErrorJson | null;
  processedLines: number;
  totalLines: number;
  linesOverrideJson: Array<{ productId: string; quantity: number; unitCost?: number; salePrice?: number; unit?: string }> | null;
  revision: number;
  branch: { id: string; code: string; name: string };
};

type IntakeDetail = Omit<IntakeListItem, "branches"> & {
  branches: IntakeDetailBranch[];
  linesDetail: IntakeLineDetail[];
};

/**
 * prompt-inventario-unificado.md Commit 1 — `kindFilter` opcional (ej.
 * "PHYSICAL_COUNT") para reusar este mismo panel como la nueva subsección
 * "Conteos" (Existencias) sin duplicar la lista/detalle: filtra en el
 * cliente sobre lo ya traído, no agrega un parámetro nuevo al backend.
 */
export function IntakeHistoryPanel({ kindFilter }: { kindFilter?: string } = {}) {
  const [items, setItems] = useState<IntakeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IntakeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Commit 2 §5 — "Con fallas" filtra sobre lo ya traído (mismo criterio
  // que kindFilter: cliente, no un parámetro nuevo al backend).
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [discardingBranchId, setDiscardingBranchId] = useState<string | null>(null);
  const [discardReason, setDiscardReason] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [fixingBranch, setFixingBranch] = useState<IntakeDetailBranch | null>(null);

  async function loadPage(nextCursor: string | null, append: boolean) {
    (append ? setLoadingMore : setLoading)(true);
    try {
      const params = new URLSearchParams({ limit: "25" });
      if (nextCursor) params.set("cursor", nextCursor);
      const response = await apiFetch(`/api/inventory/multi-branch-intake?${params}`);
      const raw = await response.json().catch(() => null);
      if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar el historial de entradas.");
      const data = unwrapApiData(raw) as { intakes: IntakeListItem[]; nextCursor: string | null };
      setItems((prev) => (append ? [...prev, ...data.intakes] : data.intakes));
      setCursor(data.nextCursor);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar el historial de entradas.");
    } finally {
      (append ? setLoadingMore : setLoading)(false);
    }
  }

  useEffect(() => {
    void loadPage(null, false);
  }, []);

  async function openDetail(id: string) {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const response = await apiFetch(`/api/inventory/multi-branch-intake/${id}`);
      const raw = await response.json().catch(() => null);
      if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar el detalle.");
      setDetail(unwrapApiData(raw) as IntakeDetail);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar el detalle.");
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  }

  /** Refresca el detalle abierto Y la fila de la lista (status/badges) después de editar/reintentar/descartar. */
  async function refreshAfterAction() {
    if (selectedId) await openDetail(selectedId);
    await loadPage(null, false);
  }

  function pendingLinesFor(branch: IntakeDetailBranch): FixSheetAppliedLine[] {
    if (!detail) return [];
    const productById = new Map(detail.linesDetail.map((l) => [l.productId, l.product]));
    if (branch.linesOverrideJson) {
      return branch.linesOverrideJson.map((l) => ({ ...l, product: productById.get(l.productId) ?? null }));
    }
    return detail.linesDetail.slice(branch.processedLines).map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: l.unitCost, salePrice: l.salePrice, unit: l.unit, product: l.product }));
  }

  function appliedLinesFor(branch: IntakeDetailBranch): FixSheetAppliedLine[] {
    if (!detail) return [];
    return detail.linesDetail.slice(0, branch.processedLines).map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: l.unitCost, salePrice: l.salePrice, unit: l.unit, product: l.product }));
  }

  async function confirmDiscard(branch: IntakeDetailBranch) {
    if (!detail) return;
    if (!discardReason.trim()) { toast.error("El motivo es obligatorio."); return; }
    setDiscarding(true);
    try {
      const response = await apiFetch(`/api/inventory/multi-branch-intake/${detail.id}/branches/${branch.branchId}/discard`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: discardReason.trim() }),
      });
      const raw = await response.json().catch(() => null);
      if (!response.ok) throw new Error(raw?.error?.message ?? "No se pudo descartar.");
      toast.success(`${branch.branch.code} descartada.`);
      setDiscardingBranchId(null);
      setDiscardReason("");
      await refreshAfterAction();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo descartar.");
    } finally {
      setDiscarding(false);
    }
  }

  const visibleItems = (kindFilter ? items.filter((item) => item.kind === kindFilter) : items)
    .filter((item) => !onlyFailed || item.branches.some((b) => b.status === "FAILED"));
  const failedCount = (kindFilter ? items.filter((item) => item.kind === kindFilter) : items).filter((item) => item.branches.some((b) => b.status === "FAILED")).length;

  return (
    <div className="space-y-3">
      {failedCount > 0 ? (
        <div className="flex justify-start">
          <button
            type="button"
            onClick={() => setOnlyFailed((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${onlyFailed ? "border-[var(--color-danger-600)] bg-[var(--color-danger-50)] text-[var(--color-danger-700)]" : "border-[var(--color-border)] text-[var(--color-text-secondary)]"}`}
          >
            <AlertCircle className="h-3.5 w-3.5" /> Con fallas ({failedCount})
          </button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="hm-table min-w-[900px] w-full">
          <thead>
            <tr>
              <th>Código</th>
              <th>Tipo</th>
              <th>Sucursales</th>
              <th>Motivo</th>
              <th>Quién</th>
              <th>Cuándo</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => {
              const hasFailed = item.branches.some((b) => b.status === "FAILED");
              return (
              <tr key={item.id} className="cursor-pointer hover:bg-[var(--color-surface-alt)]" onClick={() => void openDetail(item.id)}>
                <td className="font-mono text-xs font-semibold text-[var(--color-master-700)]">
                  {hasFailed ? <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-danger-600)]" title="Con fallas" /> : null}
                  {item.code}
                </td>
                <td className="text-xs">{INTAKE_KIND_LABELS[item.kind] ?? item.kind}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {item.branches.map((b) => (
                      <Badge key={b.branchId} variant={BRANCH_STATUS_VARIANT[b.status] ?? "neutral"} title={BRANCH_STATUS_LABEL[b.status] ?? b.status}>{b.branch.code}</Badge>
                    ))}
                  </div>
                </td>
                <td className="max-w-[220px] truncate text-xs text-[var(--color-text-secondary)]" title={item.reason}>{item.reason}</td>
                <td className="text-xs text-[var(--color-text-secondary)]">{item.createdBy?.fullName ?? <span className="text-[var(--color-text-muted)]">Sistema</span>}</td>
                <td className="whitespace-nowrap text-xs text-[var(--color-text-secondary)]">{fmtDateTime(item.createdAt)}</td>
              </tr>
              );
            })}
            {visibleItems.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-sm text-[var(--color-text-muted)]">{loading ? "Cargando…" : kindFilter ? "Todavía no hay conteos registrados." : "Todavía no hay entradas registradas."}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {cursor ? (
        <div className="flex justify-center">
          <Button type="button" variant="secondary" size="sm" loading={loadingMore} onClick={() => void loadPage(cursor, true)}>Cargar más</Button>
        </div>
      ) : null}

      {selectedId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-[var(--color-surface)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
              <h3 className="text-sm font-semibold">{detail?.code ?? "Detalle de la entrada"}</h3>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setSelectedId(null); setDetail(null); }} icon={<X className="h-4 w-4" />}>Cerrar</Button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {detailLoading || !detail ? (
                <div className="flex items-center gap-2 py-8 justify-center text-sm text-[var(--color-text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
              ) : (
                <>
                  <div className="mb-3 grid gap-1 text-xs text-[var(--color-text-secondary)]">
                    <span><strong>Tipo:</strong> {INTAKE_KIND_LABELS[detail.kind] ?? detail.kind}</span>
                    <span><strong>Motivo:</strong> {detail.reason}</span>
                    {detail.notes ? <span><strong>Nota:</strong> {detail.notes}</span> : null}
                    <span><strong>Quién:</strong> {detail.createdBy?.fullName ?? "Sistema"} · {fmtDateTime(detail.createdAt)}</span>
                  </div>
                  <div className="mb-3 space-y-1.5">
                    {detail.branches.map((b) => {
                      const isFailed = b.status === "FAILED";
                      const headerText = isFailed
                        ? (b.processedLines === 0 ? `${b.branch.code} falló — nada se aplicó` : `Se guardaron ${b.processedLines} de ${b.totalLines}; faltan ${b.totalLines - b.processedLines}`)
                        : null;
                      return (
                        <div key={b.branchId} className="space-y-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{b.branch.code} — {b.branch.name}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[var(--color-text-muted)]">{b.processedLines}/{b.totalLines} líneas</span>
                              <Badge variant={BRANCH_STATUS_VARIANT[b.status] ?? "neutral"}>{BRANCH_STATUS_LABEL[b.status] ?? b.status}</Badge>
                            </div>
                          </div>
                          {headerText ? <p className="font-medium text-[var(--color-danger-700)]">{headerText}</p> : null}
                          {isFailed && b.errorJson ? (
                            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-[var(--color-danger-600)]">
                              {b.errorJson.lines.map((l, i) => <li key={`${l.productId}-${i}`}>{l.name ? `${l.name}: ` : ""}{l.text}</li>)}
                            </ul>
                          ) : isFailed && b.error ? (
                            <p className="text-[11px] text-[var(--color-danger-600)]">{b.error}</p>
                          ) : null}
                          {isFailed ? (
                            <div className="flex flex-wrap gap-2 pt-1">
                              <Button type="button" variant="primary" size="sm" onClick={() => setFixingBranch(b)}>Editar y reintentar {b.branch.code}</Button>
                              {b.processedLines === 0 ? (
                                <Button type="button" variant="ghost" size="sm" onClick={() => { setDiscardingBranchId(b.branchId); setDiscardReason(""); }}>Descartar {b.branch.code}</Button>
                              ) : null}
                            </div>
                          ) : null}
                          {discardingBranchId === b.branchId ? (
                            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-2">
                              <input
                                className="hm-input h-8 flex-1 text-xs"
                                value={discardReason}
                                onChange={(e) => setDiscardReason(e.target.value)}
                                placeholder="Motivo del descarte (obligatorio)"
                                autoFocus
                              />
                              <Button type="button" variant="danger" size="sm" loading={discarding} onClick={() => void confirmDiscard(b)}>Confirmar</Button>
                              <Button type="button" variant="ghost" size="sm" onClick={() => { setDiscardingBranchId(null); setDiscardReason(""); }}>Cancelar</Button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
                    <table className="hm-table w-full text-xs">
                      <thead><tr><th>Producto</th><th className="text-right">Cantidad</th><th className="text-right">Costo</th></tr></thead>
                      <tbody>
                        {detail.linesDetail.map((line) => (
                          <tr key={line.productId}>
                            <td>{line.product ? <><span className="font-medium">{line.product.name}</span> <span className="font-mono text-[10px] text-[var(--color-text-muted)]">{line.product.sku}</span></> : line.productId}</td>
                            <td className="text-right">{qty(line.quantity)}{line.unit ? ` ${line.unit}` : ""}</td>
                            <td className="text-right">{line.unitCost !== undefined ? money(line.unitCost) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {fixingBranch && detail ? (
        <IntakeBranchFixSheet
          intakeId={detail.id}
          intakeCode={detail.code}
          branchId={fixingBranch.branchId}
          branchCode={fixingBranch.branch.code}
          branchName={fixingBranch.branch.name}
          appliedLines={appliedLinesFor(fixingBranch)}
          pendingLines={pendingLinesFor(fixingBranch)}
          revision={fixingBranch.revision}
          onClose={() => setFixingBranch(null)}
          onDone={refreshAfterAction}
        />
      ) : null}
    </div>
  );
}
