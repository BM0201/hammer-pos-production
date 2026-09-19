"use client";

import { useCallback, useState } from "react";
import { KeyRound, X, AlertTriangle, Check, Copy } from "lucide-react";
import { copyTextToClipboard } from "@/lib/client/clipboard";

/**
 * Fase 5 (prompt-flujo-velocidad.md): extraído de users-admin.tsx para
 * poder cargarlo con next/dynamic — solo se monta tras un reseteo masivo de
 * contraseñas, no en cada visita a Usuarios & Roles.
 */
export type BulkResetResult = { username: string; fullName: string; tempPassword: string };

export function BulkResetResultModal({
  results,
  onClose,
}: {
  results: BulkResetResult[];
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyAll = useCallback(async () => {
    await copyTextToClipboard(results.map((row) => `${row.username}: ${row.tempPassword}`).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [results]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg bg-[var(--color-surface)] rounded-xl shadow-2xl border border-[var(--color-border)] animate-fade-in overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-warning-100)]">
              <KeyRound className="h-5 w-5 text-[var(--color-warning-700)]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--color-text)]">Contraseñas temporales generadas</h3>
              <p className="text-xs text-[var(--color-text-muted)]">{results.length} usuario{results.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-text-soft)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] transition-colors"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-3">
          <div className="rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3 text-sm text-[var(--color-warning-700)] flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <p>Estas contraseñas solo se muestran una vez. Cópialas y compártelas con cada usuario; deberán cambiarlas en su próximo inicio de sesión.</p>
          </div>
          <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-[var(--color-border)]">
            <table className="hm-table w-full">
              <thead>
                <tr>
                  <th className="text-left">Usuario</th>
                  <th className="text-left">Nombre</th>
                  <th className="text-left">Contraseña temporal</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr key={row.username}>
                    <td className="font-mono">{row.username}</td>
                    <td>{row.fullName}</td>
                    <td className="font-mono tracking-wider select-all">{row.tempPassword}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
          <button
            type="button"
            onClick={copyAll}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
              copied
                ? "bg-[var(--color-success-50)] text-[var(--color-success-700)] border border-green-300"
                : "bg-[var(--color-master-600)] text-white hover:bg-[var(--color-master-700)]"
            }`}
          >
            {copied ? (
              <><Check className="h-4 w-4" /><span>¡Copiado!</span></>
            ) : (
              <><Copy className="h-4 w-4" /><span>Copiar todo</span></>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>

    </div>
  );
}
