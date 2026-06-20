"use client";

import { useEffect, useState } from "react";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Eye,
  UserX,
  Lock,
} from "lucide-react";

type AlertSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type AlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";

type SecurityAlert = {
  id: string;
  severity: AlertSeverity;
  type: string;
  title: string;
  description: string;
  status: AlertStatus;
  createdAt: string;
  actorUserId: string | null;
  note: string | null;
};

type UserMissingMfa = {
  id: string;
  username: string;
  fullName: string;
  globalRole: string;
  createdAt: string;
};

type CriticalAction = {
  id: string;
  action: string;
  occurredAt: string;
  actor: { username: string; fullName: string } | null;
};

type Overview = {
  alertCounts: { CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number; total: number };
  recentAlerts: SecurityAlert[];
  usersMissingMfa: UserMissingMfa[];
  failedLogins24h: number;
  criticalActions: CriticalAction[];
};

const SEVERITY_STYLES: Record<AlertSeverity, { badge: string; icon: React.ReactNode }> = {
  CRITICAL: { badge: "bg-red-100 text-red-700 border border-red-300", icon: <ShieldAlert className="h-3.5 w-3.5" /> },
  HIGH: { badge: "bg-orange-100 text-orange-700 border border-orange-300", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  MEDIUM: { badge: "bg-yellow-100 text-yellow-700 border border-yellow-300", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  LOW: { badge: "bg-blue-100 text-blue-700 border border-blue-300", icon: <Eye className="h-3.5 w-3.5" /> },
};

function fmt(d: string) {
  return new Date(d).toLocaleString("es-NI", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const s = SEVERITY_STYLES[severity];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${s.badge}`}>
      {s.icon}
      {severity}
    </span>
  );
}

export default function SecurityCenterPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function loadOverview() {
    setLoading(true);
    try {
      const res = await apiFetch("/api/master/security");
      const json = await res.json();
      if (res.ok) setOverview(unwrapApiData(json as ApiResponse<Overview>));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadOverview(); }, []);

  async function updateAlert(alertId: string, action: "ACKNOWLEDGE" | "RESOLVE" | "DISMISS") {
    setUpdatingId(alertId);
    try {
      await apiFetch("/api/master/security/alerts", {
        method: "PATCH",
        body: JSON.stringify({ alertId, action }),
      });
      await loadOverview();
    } finally {
      setUpdatingId(null);
    }
  }

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--color-text-muted)] text-sm">
        <RefreshCw className="h-4 w-4 animate-spin mr-2" />
        Cargando Security Center…
      </div>
    );
  }

  const counts = overview?.alertCounts ?? { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, total: 0 };

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="h-8 w-1 rounded-full flex-shrink-0"
          style={{ background: "linear-gradient(to bottom, #dc2626, #7c3aed)" }}
        />
        <div className="flex-1">
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Security Center</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Monitoreo de alertas de seguridad, MFA y auditoría
          </p>
        </div>
        <button
          onClick={loadOverview}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-soft)] hover:bg-[var(--color-surface-raised)] transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {/* Alert count cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as AlertSeverity[]).map((sev) => (
          <div key={sev} className="erp-card p-4 space-y-1">
            <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">{sev}</p>
            <p className={`text-2xl font-bold ${counts[sev] > 0 ? "text-red-600" : "text-[var(--color-text-soft)]"}`}>
              {counts[sev]}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">alerta{counts[sev] !== 1 ? "s" : ""} abiertas</p>
          </div>
        ))}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3">
        <div className="erp-card p-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600">
            <Lock className="h-5 w-5" />
          </span>
          <div>
            <p className="text-lg font-bold text-[var(--color-text)]">{overview?.failedLogins24h ?? 0}</p>
            <p className="text-xs text-[var(--color-text-muted)]">Logins fallidos (24h)</p>
          </div>
        </div>
        <div className="erp-card p-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-50 text-orange-600">
            <UserX className="h-5 w-5" />
          </span>
          <div>
            <p className="text-lg font-bold text-[var(--color-text)]">{overview?.usersMissingMfa?.length ?? 0}</p>
            <p className="text-xs text-[var(--color-text-muted)]">Usuarios sin MFA (roles críticos)</p>
          </div>
        </div>
      </div>

      {/* Users missing MFA */}
      {(overview?.usersMissingMfa?.length ?? 0) > 0 && (
        <div className="erp-card overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)] bg-orange-50">
            <UserX className="h-4 w-4 text-orange-600" />
            <h2 className="text-sm font-semibold text-orange-800">Usuarios con rol crítico sin MFA activo</h2>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {overview!.usersMissingMfa.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">{u.fullName}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">@{u.username} · {u.globalRole}</p>
                </div>
                <span className="text-xs text-orange-600 font-semibold bg-orange-50 border border-orange-200 rounded px-2 py-0.5">
                  Sin MFA
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent open alerts */}
      <div className="erp-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <ShieldAlert className="h-4 w-4 text-[var(--color-text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Alertas recientes abiertas</h2>
        </div>
        {(overview?.recentAlerts?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-[var(--color-text-muted)]">
            <CheckCircle2 className="h-8 w-8 text-green-400" />
            <p className="text-sm">Sin alertas abiertas</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {overview!.recentAlerts.map((a) => (
              <div key={a.id} className="px-4 py-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <SeverityBadge severity={a.severity} />
                    <span className="text-sm font-medium text-[var(--color-text)]">{a.title}</span>
                  </div>
                  <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmt(a.createdAt)}</span>
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">{a.description}</p>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    disabled={!!updatingId}
                    onClick={() => updateAlert(a.id, "ACKNOWLEDGE")}
                    className="text-xs px-2 py-1 rounded border border-yellow-300 text-yellow-700 bg-yellow-50 hover:bg-yellow-100 transition-colors disabled:opacity-50"
                  >
                    Reconocer
                  </button>
                  <button
                    disabled={!!updatingId}
                    onClick={() => updateAlert(a.id, "RESOLVE")}
                    className="text-xs px-2 py-1 rounded border border-green-300 text-green-700 bg-green-50 hover:bg-green-100 transition-colors disabled:opacity-50"
                  >
                    Resolver
                  </button>
                  <button
                    disabled={!!updatingId}
                    onClick={() => updateAlert(a.id, "DISMISS")}
                    className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-500 bg-gray-50 hover:bg-gray-100 transition-colors disabled:opacity-50"
                  >
                    Descartar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Critical recent actions */}
      <div className="erp-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <Clock className="h-4 w-4 text-[var(--color-text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Acciones críticas (últimas 24h)</h2>
        </div>
        {(overview?.criticalActions?.length ?? 0) === 0 ? (
          <p className="text-center text-sm text-[var(--color-text-muted)] py-8">Sin actividad crítica reciente</p>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {overview!.criticalActions.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">{a.action}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {a.actor ? `${a.actor.username}` : "sistema"}
                  </p>
                </div>
                <span className="text-xs text-[var(--color-text-muted)]">{fmt(a.occurredAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
