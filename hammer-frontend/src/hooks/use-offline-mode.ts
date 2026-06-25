"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getOfflineQueue, getPendingCount, updateOfflineSale } from "@/lib/offline-db";

export type SyncState = "idle" | "syncing" | "done" | "partial_error";

export function useOfflineMode() {
  const [isOffline, setIsOffline] = useState(
    typeof window !== "undefined" ? !navigator.onLine : false,
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [lastSyncResult, setLastSyncResult] = useState<{ synced: number; failed: number } | null>(null);
  const syncingRef = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await getPendingCount();
      setPendingCount(count);
    } catch { /* IDB not available */ }
  }, []);

  const syncQueue = useCallback(async () => {
    if (syncingRef.current) return;
    let pending;
    try {
      const queue = await getOfflineQueue();
      pending = queue.filter(s => s.status === "PENDING_SYNC" || s.status === "SYNC_FAILED");
    } catch { return; }

    if (pending.length === 0) return;

    syncingRef.current = true;
    setSyncState("syncing");
    let synced = 0;
    let failed = 0;

    for (const sale of pending) {
      try {
        const res = await fetch("/api/sales/sync-offline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sale),
        });
        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          await updateOfflineSale({
            ...sale,
            status: "SYNCED",
            serverOrderId: json?.data?.orderId,
            serverOrderNumber: json?.data?.orderNumber,
          });
          synced++;
        } else {
          const json = await res.json().catch(() => ({}));
          await updateOfflineSale({
            ...sale,
            status: "SYNC_FAILED",
            syncError: (json as { message?: string })?.message ?? "Error al sincronizar",
          });
          failed++;
        }
      } catch {
        await updateOfflineSale({ ...sale, status: "SYNC_FAILED", syncError: "Sin conexión al sincronizar" }).catch(() => {});
        failed++;
      }
    }

    syncingRef.current = false;
    setSyncState(failed > 0 ? "partial_error" : "done");
    setLastSyncResult({ synced, failed });
    await refreshPendingCount();
    setTimeout(() => setSyncState("idle"), 6000);
  }, [refreshPendingCount]);

  useEffect(() => {
    refreshPendingCount().catch(() => {});
  }, [refreshPendingCount]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      syncQueue().catch(() => {});
    };
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncQueue]);

  return { isOffline, pendingCount, syncState, lastSyncResult, syncQueue, refreshPendingCount };
}
