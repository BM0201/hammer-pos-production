"use client";

import { useEffect, useState } from "react";
import { Tag, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { money, fmtDateTime } from "@/lib/format";
import type { Branch } from "@/components/catalog-inventory/product-360";

/**
 * Fase 5 (prompt-flujo-velocidad.md): extraído de product-360.tsx (era la
 * pestaña "priceHistory", Parte B.3) para poder cargarlo con next/dynamic —
 * solo se monta cuando el usuario abre esa pestaña. Mismo comportamiento.
 */

type PriceHistoryRow = {
  id: string;
  occurredAt: string;
  field: "standardSalePrice" | "branchPrice";
  branchId: string | null;
  previousPrice: number | null;
  newPrice: number | null;
  origin: string | null;
  actorUserId: string | null;
  actorName: string | null;
  propagatedFromProductId: string | null;
  propagatedFromSku: string | null;
};

const PRICE_ORIGIN_LABEL: Record<string, string> = {
  catalogo: "Catálogo",
  fusion: "Fusiones",
  importacion_excel: "Importación Excel",
  bandeja_precios: "Bandeja de precios",
  calculadora: "Calculadora",
  saldo_inicial: "Saldo inicial",
};

export function PriceHistoryTab({ productId, branches }: { productId: string; branches: Branch[] }) {
  const [rows, setRows] = useState<PriceHistoryRow[] | null>(null);
  const [error, setError] = useState("");
  const branchById = new Map(branches.map((b) => [b.id, b]));

  useEffect(() => {
    fetch(`/api/master/catalog/price-history?productId=${productId}`, { cache: "no-store" })
      .then(async (response) => {
        const raw = await response.json();
        if (!response.ok) throw new Error(raw?.error?.message ?? raw?.message ?? "No se pudo cargar el historial de precio.");
        setRows(raw.data as PriceHistoryRow[]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar el historial de precio."));
  }, [productId]);

  if (error) {
    return (
      <Card className="p-6 text-center">
        <AlertTriangle className="h-8 w-8 mx-auto text-red-500 mb-2" />
        <p className="text-sm font-semibold text-[var(--color-danger-700)]">{error}</p>
      </Card>
    );
  }
  if (!rows) {
    return (
      <Card className="p-8 text-center">
        <div className="h-8 w-8 mx-auto mb-3 animate-spin rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-info-600)]" />
      </Card>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--color-border-strong)] overflow-hidden shadow-sm">
      <div className="hm-card-header-green px-5 py-3 flex items-center gap-2">
        <Tag className="h-5 w-5" />
        <h2 className="font-semibold">Historial de precio</h2>
        <span className="ml-auto text-xs opacity-80">{rows.length} cambios</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center">
          <Tag className="h-10 w-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
          <p className="text-sm font-medium text-[var(--color-text-secondary)]">Sin cambios de precio registrados todavía.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="hm-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Precio anterior</th>
                <th>Precio nuevo</th>
                <th>Campo</th>
                <th>Sucursal</th>
                <th>Origen</th>
                <th>Quién</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-[var(--color-surface-alt)]">
                  <td className="whitespace-nowrap text-[var(--color-text-secondary)] text-xs">{fmtDateTime(row.occurredAt)}</td>
                  <td className="text-right font-mono text-xs text-[var(--color-text-secondary)]">{row.previousPrice === null ? "—" : money(row.previousPrice)}</td>
                  <td className="text-right font-mono text-xs font-semibold text-[var(--color-text)]">{row.newPrice === null ? "—" : money(row.newPrice)}</td>
                  <td className="text-xs">
                    <Badge variant={row.field === "branchPrice" ? "info" : "neutral"}>{row.field === "branchPrice" ? "Precio de sucursal" : "Precio general"}</Badge>
                  </td>
                  <td className="text-xs text-[var(--color-text-secondary)]">{row.branchId ? branchById.get(row.branchId)?.code ?? row.branchId : "—"}</td>
                  <td className="text-xs text-[var(--color-text-secondary)]">
                    {row.origin ? PRICE_ORIGIN_LABEL[row.origin] ?? row.origin : "—"}
                    {row.propagatedFromSku && (
                      <div className="text-[10px] text-[var(--color-warning-700)]">Propagado desde {row.propagatedFromSku}</div>
                    )}
                  </td>
                  <td className="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">{row.actorName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
