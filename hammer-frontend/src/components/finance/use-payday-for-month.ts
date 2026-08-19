"use client";

import { useEffect, useState } from "react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

export type PaydayForMonthEntry = {
  date: string; // ISO
  nominalDay: number;
  adjusted: boolean;
  adjustedReason: "SUNDAY" | "SHORT_MONTH" | null;
};

/**
 * Ambas fechas de pago (1ª/2ª quincena) de un mes ya elegido en la pantalla
 * de Calcular Nómina — consume GET /api/payroll/payday-for-month, la misma
 * fuente (paydayFor) que usará el backend al postear
 * (prompt-planilla-calendario-quincenas.md §4/§6).
 */
export function usePaydayForMonth(
  year: number,
  month: number,
): { firstHalf: PaydayForMonthEntry | null; secondHalf: PaydayForMonthEntry | null; loading: boolean } {
  const [state, setState] = useState<{ firstHalf: PaydayForMonthEntry | null; secondHalf: PaydayForMonthEntry | null }>({
    firstHalf: null,
    secondHalf: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      setState({ firstHalf: null, secondHalf: null });
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetch(`/api/payroll/payday-for-month?year=${year}&month=${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        const data = unwrapApiData(raw) as { firstHalf: PaydayForMonthEntry; secondHalf: PaydayForMonthEntry };
        setState(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  return { ...state, loading };
}
