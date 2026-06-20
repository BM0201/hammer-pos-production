"use client";

import { useCallback, useRef, useState } from "react";
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

export function usePosRealtimeSummary(branchId: string) {
  const [realtimeSummary, setRealtimeSummary] = useState<PosRealtimeSummary | null>(null);
  const [summaryUpdatedAt, setSummaryUpdatedAt] = useState<string | null>(null);
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
    setSummaryUpdatedAt(new Date().toISOString());
  }, [branchId]);

  useOperationalPolling({
    task: loadRealtimeSummary,
    intervalMs: 15_000,
    deps: [loadRealtimeSummary],
    onError: () => undefined,
  });

  return { realtimeSummary, summaryUpdatedAt, loadRealtimeSummary };
}
