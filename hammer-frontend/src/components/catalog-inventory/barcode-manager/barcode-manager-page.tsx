"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Barcode } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { ScanMode } from "@/components/catalog-inventory/barcode-manager/scan-mode";
import { CategoryWalkMode } from "@/components/catalog-inventory/barcode-manager/category-walk-mode";
import { CodeListMode } from "@/components/catalog-inventory/barcode-manager/code-list-mode";

/**
 * prompt-codigos-editar-eliminar.md Fase 3.2 — pantalla nueva "Códigos de
 * barra" (reemplaza "Etiquetar catálogo"). Cuatro modos en pestañas:
 * Escanear (el principal), Recorrer por categoría, Todos los códigos y Con
 * problemas (N).
 */

type Category = { id: string; name: string };
type Branch = { id: string; name: string; code?: string | null };
type Tab = "scan" | "category-walk" | "all" | "issues";

export function BarcodeManagerPage() {
  const sessionState = useSession();
  const [tab, setTab] = useState<Tab>("scan");
  const [categories, setCategories] = useState<Category[]>([]);
  const [coverage, setCoverage] = useState<{ withBarcode: number; total: number } | null>(null);
  const [issueCount, setIssueCount] = useState<number>(0);

  const branches: Branch[] = sessionState.status === "authenticated" ? (sessionState.session.branches ?? []).map((b) => ({ id: b.id, name: b.name, code: b.code })) : [];
  const branchId = sessionState.status === "authenticated" ? getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId) ?? branches[0]?.id ?? "" : "";

  useEffect(() => {
    apiFetch("/api/catalog/categories").then((res) => res.json()).then((raw) => setCategories(unwrapApiData(raw) as Category[])).catch(() => {});
  }, []);

  // El total "Con problemas (N)" se carga de entrada (no solo al abrir esa pestaña) — así se ve que hay algo pendiente antes de entrar.
  useEffect(() => {
    apiFetch("/api/catalog/barcodes/issue-counts")
      .then((res) => res.json())
      .then((raw) => {
        const counts = unwrapApiData(raw) as Record<string, number>;
        setIssueCount(Object.values(counts).reduce((sum, n) => sum + n, 0));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (branchId) params.set("branchId", branchId);
    apiFetch(`/api/catalog/barcodes/coverage?${params}`)
      .then((res) => res.json())
      .then((raw) => setCoverage(unwrapApiData(raw) as { withBarcode: number; total: number }))
      .catch(() => toast.error("No se pudo cargar el progreso de códigos."));
  }, [branchId]);

  const pct = coverage && coverage.total > 0 ? Math.round((coverage.withBarcode / coverage.total) * 100) : null;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Barcode className="h-5 w-5 text-[var(--color-master-600)]" />
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text)]">Códigos de barra</h1>
          <p className="text-xs text-[var(--color-text-muted)]">Escaneá, editá, limpiá y etiqueta el catálogo entero desde acá.</p>
        </div>
      </div>

      {coverage ? (
        <div className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-secondary)]">
          Productos con código: {coverage.withBarcode.toLocaleString("es-NI")} de {coverage.total.toLocaleString("es-NI")}{pct !== null ? ` · ${pct} %` : ""}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)]">
        {([
          ["scan", "Escanear"],
          ["category-walk", "Recorrer por categoría"],
          ["all", "Todos los códigos"],
          ["issues", `Con problemas${issueCount > 0 ? ` (${issueCount})` : ""}`],
        ] as Array<[Tab, string]>).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-t-lg px-3 py-2 text-xs font-semibold ${tab === key ? "border-b-2 border-[var(--color-master-600)] text-[var(--color-master-700)]" : "text-[var(--color-text-muted)]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        {tab === "scan" ? <ScanMode branchId={branchId} /> : null}
        {tab === "category-walk" ? <CategoryWalkMode categories={categories} branches={branches} /> : null}
        {tab === "all" ? <CodeListMode mode="all" /> : null}
        {tab === "issues" ? <CodeListMode mode="issues" onIssueCountsLoaded={setIssueCount} /> : null}
      </div>
    </div>
  );
}
