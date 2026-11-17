"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "./button";

/**
 * Ventana modal con tokens de tema: el fondo es la página atenuada (sirve en claro y oscuro).
 * Escape y el clic afuera cierran, salvo mientras `busy`.
 */
export function Dialog({ title, subtitle, onClose, busy = false, footer, children, size = "md" }: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  footer?: ReactNode;
  children?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // En ref: el llamador pasa una función nueva en cada render y no debe re-enfocar ni re-suscribir.
  const closeRef = useRef(onClose);
  closeRef.current = busy ? () => {} : onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const width = size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : "max-w-2xl";
  // Portal al body: dentro de <main> el header y el pie de la app quedaban por encima.
  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-end justify-center bg-[color-mix(in_srgb,var(--color-page-bg)_70%,transparent)] p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[92vh] w-full ${width} flex-col overflow-hidden rounded-t-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl sm:rounded-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{subtitle}</p>}
          </div>
          <button type="button" aria-label="Cerrar" disabled={busy} onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children && <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>}
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Reemplazo de window.confirm(): misma pregunta, con el estilo de la app y estado de carga. */
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = "Volver", tone = "danger", busy = false, onConfirm, onCancel }: {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      size="sm"
      title={title}
      onClose={onCancel}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={tone} loading={busy} onClick={onConfirm} data-autofocus>{confirmLabel}</Button>
        </>
      }
    >
      {message && <div className="text-sm text-[var(--color-text-muted)]">{message}</div>}
    </Dialog>
  );
}
