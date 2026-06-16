"use client";

import { useEffect, useState } from "react";
import type { PosV2Context } from "../types";

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
  const [paymentMethod, setPaymentMethod] = useState<string>("CASH");

  useEffect(() => {
    async function loadPosContext() {
      try {
        const query = new URLSearchParams({ branchId });
        const res = await fetch(`/api/pos/v2/context?${query.toString()}`);
        const json = await res.json();
        const data = json?.data ?? json;
        setPosContext(data);
        setActiveCashSessionId(data?.assignedSessions?.[0]?.id ?? null);
        setBranchConfig({
          enableCashier: data?.workflow?.enableCashier ?? true,
          enableDispatch: data?.workflow?.enableDispatch ?? true,
          paymentWorkflowMode: data?.workflow?.paymentWorkflowMode ?? "HYBRID",
          dispatchWorkflowMode: data?.workflow?.dispatchWorkflowMode ?? "ENABLED",
        });
      } catch {
        setPosContext(null);
        setActiveCashSessionId(null);
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

  return {
    posContext,
    branchConfig,
    activeCashSessionId,
    paymentMethod,
    setPaymentMethod,
    canSendToCashier,
    canCollectHere,
  };
}
