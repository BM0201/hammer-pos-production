"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CashSessionState } from "@/components/cash-session/cash-session-panel";

/**
 * FASE 3 (UX): separa "Caja" (control de sesión) de "Cobros" (cola de cobro).
 *
 * La pantalla de Cobros ya NO renderiza el panel completo de apertura/cierre
 * de caja (eso vive ahora en la pantalla "Caja"). Sin embargo, Cobros todavía
 * necesita conocer el estado de la sesión de caja para habilitar o bloquear el
 * cobro. Este hook hace una lectura ligera (solo lectura) del estado de la
 * sesión activa de la sucursal y lo actualiza periódicamente.
 */

type CashBox = { id: string; code: string; description: string | null };
type CashSession = {
  id: string;
  status: "OPEN" | "RECONCILING" | "CLOSED" | "AUTO_CLOSED_PENDING_REVIEW";
};

const CLOSED_STATE: CashSessionState = {
  hasOpenSession: false,
  cashSessionId: null,
  physicalCashBoxId: null,
  status: null,
};

export function useCashSessionStatus(branchId: string, intervalMs = 6000) {
  const [state, setState] = useState<CashSessionState>(CLOSED_STATE);
  const [cashBoxLabel, setCashBoxLabel] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!branchId) {
      setState(CLOSED_STATE);
      setLoaded(true);
      return;
    }
    try {
      // 1) Cajas físicas de la sucursal (normalmente una sola caja física).
      const boxesQuery = new URLSearchParams({ branchId });
      const boxesResponse = await fetch(`/api/cashier/cash-boxes?${boxesQuery.toString()}`);
      const boxesJson = (await boxesResponse.json()) as { data?: CashBox[] };
      if (!boxesResponse.ok) {
        if (mountedRef.current) { setState(CLOSED_STATE); setLoaded(true); }
        return;
      }
      const boxes = boxesJson.data ?? [];
      const box = boxes[0];
      if (!box) {
        if (mountedRef.current) { setState(CLOSED_STATE); setCashBoxLabel(""); setLoaded(true); }
        return;
      }
      if (mountedRef.current) setCashBoxLabel(box.description ? `${box.code} · ${box.description}` : box.code);

      // 2) Sesión activa para esa caja.
      const sessionQuery = new URLSearchParams({ branchId, physicalCashBoxId: box.id });
      const sessionResponse = await fetch(`/api/cashier/cash-sessions/active?${sessionQuery.toString()}`);
      const sessionJson = (await sessionResponse.json()) as { data?: CashSession | null };
      if (!sessionResponse.ok) {
        if (mountedRef.current) { setState({ ...CLOSED_STATE, physicalCashBoxId: box.id }); setLoaded(true); }
        return;
      }
      const session = sessionJson.data ?? null;
      if (!mountedRef.current) return;
      if (session?.status === "RECONCILING") {
        setState({ hasOpenSession: false, cashSessionId: session.id, physicalCashBoxId: box.id, status: "RECONCILING" });
      } else {
        setState({
          hasOpenSession: Boolean(session),
          cashSessionId: session?.id ?? null,
          physicalCashBoxId: box.id,
          status: (session?.status as CashSessionState["status"]) ?? null,
        });
      }
      setLoaded(true);
    } catch {
      if (mountedRef.current) { setState(CLOSED_STATE); setLoaded(true); }
    }
  }, [branchId]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const timer = window.setInterval(() => { refresh().catch(() => undefined); }, intervalMs);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [refresh, intervalMs]);

  return { state, cashBoxLabel, loaded, refresh };
}
