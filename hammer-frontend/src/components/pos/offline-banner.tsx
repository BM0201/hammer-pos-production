"use client";

import { CheckCircle2, CloudOff, Loader2, WifiOff } from "lucide-react";
import type { SyncState } from "@/hooks/use-offline-mode";

type Props = {
  isOffline: boolean;
  pendingCount: number;
  syncState: SyncState;
  lastSyncResult: { synced: number; failed: number } | null;
  onSync: () => void;
};

export function OfflineBanner({ isOffline, pendingCount, syncState, lastSyncResult, onSync }: Props) {
  if (!isOffline && pendingCount === 0 && syncState === "idle") return null;

  // Online and done syncing
  if (!isOffline && syncState === "done" && lastSyncResult) {
    return (
      <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
        style={{ background: "var(--color-success-100)", color: "var(--color-success-700)", border: "0.5px solid var(--color-success-300)" }}>
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>
          Conexión restablecida — {lastSyncResult.synced} venta{lastSyncResult.synced !== 1 ? "s" : ""} sincronizada{lastSyncResult.synced !== 1 ? "s" : ""}.
          {lastSyncResult.failed > 0 && ` ${lastSyncResult.failed} con error.`}
        </span>
      </div>
    );
  }

  // Syncing
  if (!isOffline && syncState === "syncing") {
    return (
      <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
        style={{ background: "var(--color-info-100)", color: "var(--color-info-700)", border: "0.5px solid var(--color-info-300)" }}>
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        <span>Sincronizando ventas offline…</span>
      </div>
    );
  }

  // Online but has pending/failed sales
  if (!isOffline && pendingCount > 0) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm"
        style={{ background: "var(--color-warning-100)", color: "var(--color-warning-700)", border: "0.5px solid var(--color-warning-300)" }}>
        <div className="flex items-center gap-2">
          <CloudOff className="h-4 w-4 shrink-0" />
          <span>{pendingCount} venta{pendingCount !== 1 ? "s" : ""} pendiente{pendingCount !== 1 ? "s" : ""} de sincronización.</span>
        </div>
        <button
          onClick={onSync}
          className="rounded-lg px-3 py-1 text-xs font-medium transition-colors"
          style={{ background: "var(--color-warning-600)", color: "#fff" }}
        >
          Sincronizar
        </button>
      </div>
    );
  }

  // Offline
  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
      style={{ background: "var(--color-danger-100)", color: "var(--color-danger-700)", border: "0.5px solid var(--color-danger-300)" }}>
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>
        <strong>Modo sin conexión</strong> — Solo efectivo disponible.
        {pendingCount > 0 && ` ${pendingCount} venta${pendingCount !== 1 ? "s" : ""} en cola.`}
      </span>
    </div>
  );
}
