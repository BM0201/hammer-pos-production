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

const COLORS = {
  success: "bg-[var(--color-success-50)] border-[var(--color-success-500)] text-[var(--color-success-700)]",
  error: "bg-[var(--color-danger-50)] border-[var(--color-danger-500)] text-[var(--color-danger-700)]",
  warning: "bg-[var(--color-warning-50)] border-[var(--color-warning-500)] text-[var(--color-warning-700)]",
  info: "bg-[var(--color-info-50)] border-[var(--color-info-400)] text-[var(--color-info-700)]",
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
    <div className="fixed top-4 right-4 z-[9999] space-y-2 max-w-sm w-full">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type];
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-3 p-4 rounded-lg border-l-4 shadow-lg animate-slide-in ${COLORS[toast.type]}`}
          >
            <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm font-medium flex-1">{toast.message}</p>
            <button onClick={() => dismiss(toast.id)} className="flex-shrink-0 hover:opacity-70">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
