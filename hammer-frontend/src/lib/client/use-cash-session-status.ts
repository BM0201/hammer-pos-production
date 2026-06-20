"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CashSessionState } from "@/components/cash-session/cash-session-panel";

type CashBox = { id: string; code: string; description: string | null };
type CashSession = {
  id: string;
  status: "OPEN" | "RECONCILING" | "CLOSED" | "AUTO_CLOSED_PENDING_REVIEW";
  canOperate?: boolean;
  physicalCashBox?: CashBox;
};

const CLOSED_STATE: CashSessionState = {
  hasOpenSession: false,
  cashSessionId: null,
  physicalCashBoxId: null,
  status: null,
};

function cashBoxLabel(box: CashBox | null | undefined) {
  if (!box) return "";
  return box.description ? `${box.code} - ${box.description}` : box.code;
}

export function useCashSessionStatus(branchId: string, intervalMs = 6000) {
  const [state, setState] = useState<CashSessionState>(CLOSED_STATE);
  const [cashBoxLabelText, setCashBoxLabelText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [operatorRequired, setOperatorRequired] = useState(false);
  const [requiresCashBoxSelection, setRequiresCashBoxSelection] = useState(false);
  const mountedRef = useRef(true);

  const publishSession = useCallback((session: CashSession, box: CashBox | null) => {
    const canOperate = session.canOperate ?? false;
    setCashBoxLabelText(cashBoxLabel(box));
    setRequiresCashBoxSelection(false);

    if (session.status === "RECONCILING") {
      setState({ hasOpenSession: false, cashSessionId: session.id, physicalCashBoxId: box?.id ?? null, status: "RECONCILING" });
      setOperatorRequired(false);
      return;
    }

    if (session.status === "OPEN" && !canOperate) {
      setState({ hasOpenSession: false, cashSessionId: session.id, physicalCashBoxId: box?.id ?? null, status: "OPEN" });
      setOperatorRequired(true);
      return;
    }

    setState({
      hasOpenSession: session.status === "OPEN",
      cashSessionId: session.id,
      physicalCashBoxId: box?.id ?? null,
      status: session.status as CashSessionState["status"],
    });
    setOperatorRequired(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!branchId) {
      setState(CLOSED_STATE);
      setCashBoxLabelText("");
      setOperatorRequired(false);
      setRequiresCashBoxSelection(false);
      setLoaded(true);
      return;
    }

    try {
      const branchSessionQuery = new URLSearchParams({ branchId });
      const branchSessionResponse = await fetch(`/api/cashier/cash-sessions/active?${branchSessionQuery.toString()}`);
      const branchSessionJson = (await branchSessionResponse.json()) as { data?: CashSession | null };

      if (branchSessionResponse.ok && branchSessionJson.data) {
        if (!mountedRef.current) return;
        publishSession(branchSessionJson.data, branchSessionJson.data.physicalCashBox ?? null);
        setLoaded(true);
        return;
      }

      const boxesQuery = new URLSearchParams({ branchId });
      const boxesResponse = await fetch(`/api/cashier/cash-boxes?${boxesQuery.toString()}`);
      const boxesJson = (await boxesResponse.json()) as { data?: CashBox[] };
      if (!boxesResponse.ok) {
        if (mountedRef.current) {
          setState(CLOSED_STATE);
          setCashBoxLabelText("");
          setOperatorRequired(false);
          setRequiresCashBoxSelection(false);
          setLoaded(true);
        }
        return;
      }

      const boxes = boxesJson.data ?? [];
      if (boxes.length !== 1) {
        if (mountedRef.current) {
          setState(CLOSED_STATE);
          setCashBoxLabelText("");
          setOperatorRequired(false);
          setRequiresCashBoxSelection(boxes.length > 1);
          setLoaded(true);
        }
        return;
      }

      const box = boxes[0];
      const sessionQuery = new URLSearchParams({ branchId, physicalCashBoxId: box.id });
      const sessionResponse = await fetch(`/api/cashier/cash-sessions/active?${sessionQuery.toString()}`);
      const sessionJson = (await sessionResponse.json()) as { data?: CashSession | null };
      if (!sessionResponse.ok) {
        if (mountedRef.current) {
          setState({ ...CLOSED_STATE, physicalCashBoxId: box.id });
          setCashBoxLabelText(cashBoxLabel(box));
          setOperatorRequired(false);
          setRequiresCashBoxSelection(false);
          setLoaded(true);
        }
        return;
      }

      if (!mountedRef.current) return;
      const session = sessionJson.data ?? null;
      if (session) {
        publishSession(session, session.physicalCashBox ?? box);
      } else {
        setState({ ...CLOSED_STATE, physicalCashBoxId: box.id });
        setCashBoxLabelText(cashBoxLabel(box));
        setOperatorRequired(false);
        setRequiresCashBoxSelection(false);
      }
      setLoaded(true);
    } catch {
      if (mountedRef.current) {
        setState(CLOSED_STATE);
        setCashBoxLabelText("");
        setOperatorRequired(false);
        setRequiresCashBoxSelection(false);
        setLoaded(true);
      }
    }
  }, [branchId, publishSession]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const timer = window.setInterval(() => { refresh().catch(() => undefined); }, intervalMs);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [refresh, intervalMs]);

  return {
    state,
    cashBoxLabel: cashBoxLabelText,
    loaded,
    refresh,
    operatorRequired,
    requiresCashBoxSelection,
  };
}
