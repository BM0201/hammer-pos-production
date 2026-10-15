"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Download, Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { countByIssue, type BarcodeIssue, type BarcodeKind } from "@/lib/barcode-manager-logic";

/**
 * prompt-codigos-editar-eliminar.md Fase 3.1 — "Todos los códigos" y "Con
 * problemas (N)" comparten esta misma lista (la de Fase 1.3): en modo
 * "issues" el filtro es obligatorio y se elige con chips (uno por
 * problema, con su conteo real — countBarcodeIssues, no solo lo de una
 * página); en modo "all" el filtro de problema es opcional, en un select.
 */

const KIND_LABELS: Record<BarcodeKind, string> = { FACTORY: "Fábrica", INTERNAL: "Interno", SUPPLIER: "Proveedor" };
const ISSUE_LABELS: Record<BarcodeIssue, string> = {
  CHECKSUM_INVALID: "Dígito verificador inválido",
  PRODUCT_INACTIVE: "Producto inactivo",
  PRODUCT_MERGED: "Producto unificado",
  MULTIPLE_CODES: "3+ códigos",
  INTERNAL_SKU_MISMATCH: "HMR- desactualizado",
  NO_PRIMARY: "Sin principal",
};
const ALL_ISSUES: BarcodeIssue[] = ["CHECKSUM_INVALID", "PRODUCT_INACTIVE", "PRODUCT_MERGED", "MULTIPLE_CODES", "INTERNAL_SKU_MISMATCH", "NO_PRIMARY"];

type BarcodeRow = {
  id: string;
  code: string;
  kind: BarcodeKind;
  isPrimary: boolean;
  createdAt: string;
  product: { id: string; name: string; sku: string; isActive: boolean; isMerged: boolean; barcodeCount: number };
  issues: BarcodeIssue[];
};

export function CodeListMode({ mode, onIssueCountsLoaded }: { mode: "all" | "issues"; onIssueCountsLoaded?: (total: number) => void }) {
  const [rows, setRows] = useState<BarcodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<BarcodeKind | "">("");
  const [issue, setIssue] = useState<BarcodeIssue | "">("");
  const [issueCounts, setIssueCounts] = useState<Record<BarcodeIssue, number> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [showBulkRemove, setShowBulkRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function load(nextCursor: string | null, append: boolean) {
    (append ? setLoadingMore : setLoading)(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (q.trim()) params.set("q", q.trim());
      if (kind) params.set("kind", kind);
      if (issue) params.set("issue", issue);
      if (nextCursor) params.set("cursor", nextCursor);
      const res = await apiFetch(`/api/catalog/barcodes?${params}`);
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudieron cargar los códigos.");
      const data = unwrapApiData(raw) as { barcodes: BarcodeRow[]; nextCursor: string | null };
      setRows((prev) => (append ? [...prev, ...data.barcodes] : data.barcodes));
      setCursor(data.nextCursor);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron cargar los códigos.");
    } finally {
      (append ? setLoadingMore : setLoading)(false);
    }
  }

  // Modo "issues": conteos reales por problema (no solo lo de una página) — el primero con datos queda elegido por default.
  useEffect(() => {
    if (mode !== "issues") return;
    apiFetch("/api/catalog/barcodes/issue-counts")
      .then((res) => res.json())
      .then((raw) => {
        const counts = unwrapApiData(raw) as Record<BarcodeIssue, number>;
        setIssueCounts(counts);
        const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
        onIssueCountsLoaded?.(total);
        setIssue((current) => current || (ALL_ISSUES.find((i) => counts[i] > 0) ?? ""));
      })
      .catch(() => toast.error("No se pudieron cargar los conteos de problemas."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode === "issues" && !issue) return; // esperando el default de arriba.
    const timer = window.setTimeout(() => { setSelected(new Set()); void load(null, false); }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, kind, issue, mode]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  async function confirmBulkRemove() {
    if (!reason.trim() || selected.size === 0) return;
    setRemoving(true);
    try {
      const res = await apiFetch("/api/catalog/barcodes/bulk-remove", { method: "POST", body: JSON.stringify({ ids: [...selected], reason: reason.trim() }) });
      const raw = await res.json().catch(() => null);
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo quitar en lote.");
      const data = unwrapApiData(raw) as { removed: Array<{ id: string }>; failed: Array<{ id: string; error: string }> };
      if (data.failed.length === 0) toast.success(`${data.removed.length} código(s) quitado(s).`);
      else toast.error(`${data.removed.length} quitado(s), ${data.failed.length} falló(ron).`);
      setShowBulkRemove(false);
      setReason("");
      setSelected(new Set());
      await load(null, false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo quitar en lote.");
    } finally {
      setRemoving(false);
    }
  }

  function exportCsvUrl(): string {
    const params = new URLSearchParams({ format: "csv" });
    if (q.trim()) params.set("q", q.trim());
    if (kind) params.set("kind", kind);
    if (issue) params.set("issue", issue);
    return `/api/catalog/barcodes?${params}`;
  }

  return (
    <div className="space-y-3">
      {mode === "issues" && issueCounts ? (
        <div className="flex flex-wrap gap-2">
          {ALL_ISSUES.filter((i) => issueCounts[i] > 0).map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIssue(i)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${issue === i ? "border-[var(--color-master-600)] bg-[var(--color-master-50)] text-[var(--color-master-700)]" : "border-[var(--color-border)] text-[var(--color-text-secondary)]"}`}
            >
              {ISSUE_LABELS[i]} ({issueCounts[i]})
            </button>
          ))}
          {Object.values(issueCounts).every((n) => n === 0) ? <p className="text-sm text-[var(--color-text-muted)]">Sin problemas pendientes. 🎉</p> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-10 flex-1 min-w-[220px]" placeholder="Buscar por código, nombre o SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="hm-input h-10 w-36" value={kind} onChange={(e) => setKind(e.target.value as BarcodeKind | "")}>
          <option value="">Todos los tipos</option>
          {(Object.keys(KIND_LABELS) as BarcodeKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
        </select>
        {mode === "all" ? (
          <select className="hm-input h-10 w-56" value={issue} onChange={(e) => setIssue(e.target.value as BarcodeIssue | "")}>
            <option value="">Sin filtrar por problema</option>
            {ALL_ISSUES.map((i) => <option key={i} value={i}>{ISSUE_LABELS[i]}</option>)}
          </select>
        ) : null}
        <a href={exportCsvUrl()} className="hm-icon-btn h-10 w-10" title="Exportar CSV"><Download className="h-4 w-4" /></a>
      </div>

      {selected.size > 0 ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-master-200)] bg-[var(--color-master-50)] px-3 py-2 text-sm">
          <span>{selected.size} seleccionado(s)</span>
          <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setShowBulkRemove(true)}>Quitar seleccionados</Button>
        </div>
      ) : null}

      {mode === "all" && rows.length > 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">{Object.values(countByIssue(rows)).reduce((sum, n) => sum + n, 0)} código(s) con algún problema en esta página.</p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="hm-table min-w-[900px] w-full">
          <thead>
            <tr>
              <th><input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleSelectAll} /></th>
              <th>Código</th>
              <th>Tipo</th>
              <th>Producto</th>
              <th>Problemas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-[var(--color-surface-alt)]">
                <td><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelected(row.id)} /></td>
                <td className="font-mono text-xs">{row.code}{row.isPrimary ? <Badge variant="success" className="ml-1">Ppal.</Badge> : null}</td>
                <td className="text-xs">{KIND_LABELS[row.kind]}</td>
                <td>
                  <div className="text-sm font-medium">{row.product.name}</div>
                  <div className="font-mono text-[10px] text-[var(--color-text-muted)]">{row.product.sku}</div>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {row.issues.map((i) => <Badge key={i} variant="warning">{ISSUE_LABELS[i]}</Badge>)}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-sm text-[var(--color-text-muted)]">{loading ? "Cargando…" : "Sin resultados."}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {cursor ? (
        <div className="flex justify-center">
          <Button size="sm" variant="secondary" loading={loadingMore} onClick={() => void load(cursor, true)}>Cargar más</Button>
        </div>
      ) : null}

      {showBulkRemove ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold">Quitar {selected.size} código(s)</h3>
            <Input className="mt-3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (obligatorio)" autoFocus />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowBulkRemove(false)} disabled={removing}>Cancelar</Button>
              <Button variant="danger" loading={removing} disabled={!reason.trim()} icon={<Trash2 className="h-4 w-4" />} onClick={() => void confirmBulkRemove()}>Quitar</Button>
            </div>
          </div>
        </div>
      ) : null}
      {loading ? <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-muted)]" /></div> : null}
    </div>
  );
}
