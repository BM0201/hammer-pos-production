"use client";
import { useState, useEffect, useCallback } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const STYLES: Record<ToastType, { container: string; icon: string; bar: string }> = {
  success: {
    container: "bg-[var(--color-surface)] border border-[var(--color-success-200)] text-[var(--color-success-700)]",
    icon: "text-[var(--color-success-600)]",
    bar: "bg-[var(--color-success-500)]",
  },
  error: {
    container: "bg-[var(--color-surface)] border border-[var(--color-danger-200)] text-[var(--color-danger-700)]",
    icon: "text-[var(--color-danger-600)]",
    bar: "bg-[var(--color-danger-500)]",
  },
  warning: {
    container: "bg-[var(--color-surface)] border border-[var(--color-warning-200)] text-[var(--color-warning-700)]",
    icon: "text-[var(--color-warning-600)]",
    bar: "bg-[var(--color-warning-500)]",
  },
  info: {
    container: "bg-[var(--color-surface)] border border-[var(--color-info-200)] text-[var(--color-info-700)]",
    icon: "text-[var(--color-info-600)]",
    bar: "bg-[var(--color-info-500)]",
  },
};

let toastListeners: ((toast: Toast) => void)[] = [];

/** Call from anywhere to show a toast */
export function showToast(type: ToastType, message: string, duration = 4000) {
  const toast: Toast = { id: Date.now().toString(), type, message, duration };
  toastListeners.forEach((fn) => fn(toast));
}

/** Place <ToastContainer /> once in the root layout */
export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (toast: Toast) => {
      setToasts((prev) => [...prev, toast]);
      if (toast.duration && toast.duration > 0) {
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toast.id)), toast.duration);
      }
    };
    toastListeners.push(handler);
    return () => {
      toastListeners = toastListeners.filter((fn) => fn !== handler);
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 z-[9999] space-y-2 max-w-sm w-full"
      role="region"
      aria-live="polite"
      aria-label="Notificaciones"
    >
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type];
        const style = STYLES[toast.type];
        return (
          <div
            key={toast.id}
            className={`relative flex items-start gap-3 p-4 rounded-xl overflow-hidden shadow-[var(--shadow-lg)] animate-slide-down ${style.container}`}
          >
            {/* Left color bar */}
            <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${style.bar}`} />

            <Icon className={`h-5 w-5 flex-shrink-0 mt-0.5 ml-2 ${style.icon}`} />
            <p className="text-sm font-medium flex-1 leading-relaxed">{toast.message}</p>
            <button
              onClick={() => dismiss(toast.id)}
              className="hm-icon-btn flex-shrink-0 -mt-0.5 -mr-1"
              aria-label="Cerrar notificación"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
