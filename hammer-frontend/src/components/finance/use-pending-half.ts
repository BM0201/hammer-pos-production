"use client";

import { useEffect, useState } from "react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { pendingHalf } from "@/components/finance/payroll-calc";

type DisbursementPeriod = { period: "FIRST_HALF" | "SECOND_HALF"; status: string };

/**
 * Quincena PENDIENTE de pago de la corrida real de un mes/sucursal — consume
 * GET /api/payroll/pending-half y aplica pendingHalf() sobre el estado real
 * de los desembolsos, no sobre el calendario
 * (prompt-planilla-calendario-quincenas.md §1/§6). `branchId` es requerido:
 * sin sucursal seleccionada la pregunta "qué corrida" es ambigua (una corrida
 * por sucursal), así que el panel debe mostrar el fallback de calendario en
 * ese caso.
 */
export function usePendingHalf(year: number, month: number, branchId: string): { half: 1 | 2 | null; loading: boolean } {
  const [half, setHalf] = useState<1 | 2 | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!branchId) {
      setHalf(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ year: String(year), month: String(month), branchId });
    apiFetch(`/api/payroll/pending-half?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        const data = unwrapApiData(raw) as DisbursementPeriod[];
        setHalf(pendingHalf(data));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, month, branchId]);

  return { half, loading };
}
