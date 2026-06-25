"use client";

import { useEffect, useState } from "react";
import { getPosContext, savePosContext } from "@/lib/offline-db";
import type { CashSessionProblem, PosV2Context } from "../types";

type BranchConfig = {
  enableCashier: boolean;
  enableDispatch: boolean;
  paymentWorkflowMode: "QUEUE_ONLY" | "DIRECT_ONLY" | "HYBRID";
  dispatchWorkflowMode: "DISABLED" | "ENABLED";
};

const DEFAULT_CONFIG: BranchConfig = {
  enableCashier: true,
  enableDispatch: true,
  paymentWorkflowMode: "HYBRID",
  dispatchWorkflowMode: "ENABLED",
};

export function usePosCashContext(branchId: string) {
  const [branchConfig, setBranchConfig] = useState<BranchConfig | null>(null);
  const [posContext, setPosContext] = useState<PosV2Context | null>(null);
  const [activeCashSessionId, setActiveCashSessionId] = useState<string | null>(null);
  const [cashSessionProblem, setCashSessionProblem] = useState<CashSessionProblem | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>("CASH");

  useEffect(() => {
    async function loadPosContext() {
      try {
        const query = new URLSearchParams({ branchId });
        const res = await fetch(`/api/pos/v2/context?${query.toString()}`);
        const json = await res.json();
        const data = json?.data ?? json;
        setPosContext(data);
        const sessionId = data?.activeCashSessionId ?? data?.assignedSessions?.[0]?.id ?? null;
        setActiveCashSessionId(sessionId);
        setCashSessionProblem(data?.cashSessionProblem ?? null);
        setBranchConfig({
          enableCashier: data?.workflow?.enableCashier ?? true,
          enableDispatch: data?.workflow?.enableDispatch ?? true,
          paymentWorkflowMode: data?.workflow?.paymentWorkflowMode ?? "HYBRID",
          dispatchWorkflowMode: data?.workflow?.dispatchWorkflowMode ?? "ENABLED",
        });
        // Persist context for offline mode (cashSessionId + userId needed to sync)
        if (sessionId && data?.operatorUserId) {
          savePosContext({
            branchId,
            cashSessionId: sessionId,
            operatorUserId: data.operatorUserId,
            savedAt: new Date().toISOString(),
          }).catch(() => {});
        }
      } catch {
        // Network error: fall back to last cached context
        const cached = await getPosContext(branchId).catch(() => null);
        if (cached?.cashSessionId) {
          setActiveCashSessionId(cached.cashSessionId);
        } else {
          setActiveCashSessionId(null);
        }
        setPosContext(null);
        setCashSessionProblem(null);
        setBranchConfig(DEFAULT_CONFIG);
      }
    }
    loadPosContext();
  }, [branchId]);

  const canSendToCashier =
    Boolean(posContext?.permissions?.canSendToCashier) &&
    branchConfig?.paymentWorkflowMode !== "DIRECT_ONLY";

  const canCollectHere =
    Boolean(posContext?.permissions?.canCollectHere) &&
    branchConfig?.paymentWorkflowMode !== "QUEUE_ONLY";

  const hasOpenCashSession = posContext?.hasOpenCashSession ?? (activeCashSessionId !== null);

  return {
    posContext,
    branchConfig,
    activeCashSessionId,
    cashSessionProblem,
    hasOpenCashSession,
    paymentMethod,
    setPaymentMethod,
    canSendToCashier,
    canCollectHere,
  };
}
