"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useOperationalPolling } from "@/lib/realtime/use-operational-polling";

type PosRealtimeSummary = {
  paidSalesTotal: number;
  paidSalesCount: number;
  pendingPaymentTotal: number;
  pendingPaymentCount: number;
  lastSale: {
    orderNumber: string;
    amount: number;
    paidAt: string;
    method: string;
  } | null;
};

type PosRealtimeSummaryValue = {
  branchId: string;
  realtimeSummary: PosRealtimeSummary | null;
  loadRealtimeSummary: () => Promise<void>;
};

/**
 * PosShell comparte su resumen. Antes la caja tenía su propia copia: el
 * endpoint (~1 s en la tablet) se pedía dos veces y, tras una venta, la caja
 * recargaba SU copia mientras la barra de arriba esperaba al próximo poll.
 */
export const PosRealtimeSummaryShare = createContext<PosRealtimeSummaryValue | null>(null);

export function usePosRealtimeSummary(branchId: string): PosRealtimeSummaryValue {
  const shared = useContext(PosRealtimeSummaryShare);
  const reuse = shared?.branchId === branchId;

  const [realtimeSummary, setRealtimeSummary] = useState<PosRealtimeSummary | null>(null);
  // Monotonically-increasing sequence number so stale in-flight responses
  // (from a previous poll tick) never overwrite a fresher one that resolved first.
  const summaryRequestId = useRef(0);

  const loadRealtimeSummary = useCallback(async () => {
    const requestId = ++summaryRequestId.current;
    const response = await apiFetch(`/api/branch/pos/realtime-summary?branchId=${encodeURIComponent(branchId)}`);
    if (!response.ok) return;
    const raw = await response.json();
    const payload = unwrapApiData(raw) as { summary: PosRealtimeSummary };
    if (requestId !== summaryRequestId.current) return;
    setRealtimeSummary(payload.summary);
  }, [branchId]);

  useOperationalPolling({
    task: loadRealtimeSummary,
    intervalMs: 15_000,
    enabled: !reuse,
    deps: [loadRealtimeSummary],
    onError: () => undefined,
  });

  const own = useMemo(
    () => ({ branchId, realtimeSummary, loadRealtimeSummary }),
    [branchId, realtimeSummary, loadRealtimeSummary],
  );
  return reuse ? shared : own;
}
