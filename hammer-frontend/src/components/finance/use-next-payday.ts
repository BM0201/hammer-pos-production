"use client";

import { useEffect, useState } from "react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { buildPaydayInfo, type PaydayInfo, type NextPaydayApiResult } from "@/components/finance/payroll-calc";

/**
 * Próximo pago quincenal (calendario) — consume GET /api/payroll/next-payday
 * en vez de recalcular la fecha en el cliente
 * (prompt-planilla-calendario-quincenas.md §3/§6). Compartido entre el
 * header de Planilla y el recordatorio del dashboard: un solo fetch, una
 * sola fuente de verdad para "cuál es el próximo día de pago".
 */
export function useNextPayday(): { payday: PaydayInfo | null; loading: boolean } {
  const [payday, setPayday] = useState<PaydayInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/payroll/next-payday")
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        const data = unwrapApiData(raw) as NextPaydayApiResult;
        setPayday(buildPaydayInfo(data));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { payday, loading };
}
