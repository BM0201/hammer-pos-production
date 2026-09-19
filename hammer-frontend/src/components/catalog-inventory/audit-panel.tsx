"use client";

import { BarChart3 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/format";
import type { AuditRow } from "@/components/catalog-inventory/catalog-inventory-admin";

/**
 * Fase 5 (prompt-flujo-velocidad.md): extraído de catalog-inventory-admin.tsx
 * (era la pestaña "audit") para poder cargarlo con next/dynamic — solo se
 * monta cuando el usuario abre esa pestaña. Mismo comportamiento.
 */
export function AuditPanel({ logs }: { logs: AuditRow[] }) {
  return (
    <Card noPadding>
      <div className="hm-card-header-red">
        <h2 className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Auditoría</h2>
      </div>
      <div className="overflow-x-auto p-4">
        <table className="hm-table min-w-[760px] w-full">
          <thead>
            <tr><th>Fecha</th><th>Módulo</th><th>Acción</th><th>Entidad</th><th>Sucursal</th><th>Usuario</th></tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{fmtDateTime(log.occurredAt)}</td>
                <td>{log.module}</td>
                <td>{log.action}</td>
                <td>{log.entityType}</td>
                <td>{log.branch?.code ?? "GLOBAL"}</td>
                <td>{log.actor ? `${log.actor.fullName || log.actor.username}` : "sistema"}</td>
              </tr>
            ))}
            {logs.length === 0 ? <tr><td colSpan={6} className="py-6 text-center text-[var(--color-text-muted)]">Sin registros de auditoría.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
