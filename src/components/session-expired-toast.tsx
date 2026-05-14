"use client";

import { useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";

/**
 * Renders a warning banner when the URL contains `?expired=1`,
 * indicating that the user's session has expired.
 */
export function SessionExpiredToast() {
  const searchParams = useSearchParams();
  const isExpired = searchParams.get("expired") === "1";

  if (!isExpired) return null;

  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4"
    >
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      <span>Tu sesión expiró. Por favor, inicia sesión de nuevo.</span>
    </div>
  );
}
