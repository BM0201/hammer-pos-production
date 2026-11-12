"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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

// La caja vuelve a pedir el contexto al montarse (el shell sigue montado al
// navegar y su copia puede ser vieja), salvo si el shell lo pidió hace menos de esto.
const FRESH_ENOUGH_MS = 3_000;

type PosCashContextValue = ReturnType<typeof useLoadedPosCashContext>;

/** PosShell comparte su contexto de caja: antes /api/pos/v2/context se pedía dos veces. */
export const PosCashContextShare = createContext<PosCashContextValue | null>(null);

export function usePosCashContext(branchId: string): PosCashContextValue {
  const shared = useContext(PosCashContextShare);
  const reuse = shared?.branchId === branchId;
  const own = useLoadedPosCashContext(branchId, !reuse);

  const refreshShared = reuse ? shared.refresh : null;
  useEffect(() => {
    refreshShared?.(FRESH_ENOUGH_MS);
  }, [refreshShared]);

  return reuse ? shared : own;
}

function useLoadedPosCashContext(branchId: string, enabled: boolean) {
  const [branchConfig, setBranchConfig] = useState<BranchConfig | null>(null);
  const [posContext, setPosContext] = useState<PosV2Context | null>(null);
  const [activeCashSessionId, setActiveCashSessionId] = useState<string | null>(null);
  const [cashSessionProblem, setCashSessionProblem] = useState<CashSessionProblem | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>("CASH");
  const lastLoad = useRef({ branchId: "", at: 0 });

  const refresh = useCallback(async (maxAgeMs = 0) => {
    if (lastLoad.current.branchId === branchId && Date.now() - lastLoad.current.at < maxAgeMs) return;
    lastLoad.current = { branchId, at: Date.now() };
    try {
      const query = new URLSearchParams({ branchId });
      const res = await fetch(`/api/pos/v2/context?${query.toString()}`);
      // Bug: una respuesta no-ok (401 por sesión vencida, 500, etc.) se
      // parseaba igual y `data` quedaba undefined -> se interpretaba
      // silenciosamente como "sin sesión" -> pill "Caja cerrada", en vez de
      // caer al fallback de caché de abajo (ya diseñado para esto).
      if (!res.ok) throw new Error(`POS_CONTEXT_${res.status}`);
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
  }, [branchId]);

  // Con ventana: los efectos del hijo (la caja) corren antes que los del shell,
  // así que la caja puede haber disparado ya esta misma carga.
  useEffect(() => {
    if (enabled) void refresh(FRESH_ENOUGH_MS);
  }, [enabled, refresh]);

  const canSendToCashier =
    Boolean(posContext?.permissions?.canSendToCashier) &&
    branchConfig?.paymentWorkflowMode !== "DIRECT_ONLY";

  const canCollectHere =
    Boolean(posContext?.permissions?.canCollectHere) &&
    branchConfig?.paymentWorkflowMode !== "QUEUE_ONLY";

  const hasOpenCashSession = posContext?.hasOpenCashSession ?? (activeCashSessionId !== null);

  return useMemo(() => ({
    branchId,
    refresh,
    posContext,
    branchConfig,
    activeCashSessionId,
    cashSessionProblem,
    hasOpenCashSession,
    paymentMethod,
    setPaymentMethod,
    canSendToCashier,
    canCollectHere,
  }), [branchId, refresh, posContext, branchConfig, activeCashSessionId, cashSessionProblem, hasOpenCashSession, paymentMethod, canSendToCashier, canCollectHere]);
}
