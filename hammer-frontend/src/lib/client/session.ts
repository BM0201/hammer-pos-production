/**
 * Client-side session helpers.
 *
 * Provides hooks for fetching and consuming the authenticated session from
 * /api/auth/session. Session data flows through the layout via React state;
 * this hook is for pages that need it directly without prop-drilling.
 */
"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import type { SessionPayload } from "@/types/auth";

export type SessionState =
  | { status: "loading"; session: null; error: null }
  | { status: "authenticated"; session: SessionPayload; error: null }
  | { status: "unauthenticated"; session: null; error: null }
  | { status: "error"; session: null; error: string };

/**
 * Sesión que el layout de /app ya trajo. Sin esto cada página y cada panel
 * volvía a pedir /api/auth/session en cascada (3 idas seguidas en la caja,
 * ~300 ms cada una en la tablet).
 */
export const SessionContext = createContext<SessionPayload | null>(null);

/**
 * Hook that fetches the current session and exposes it as React state.
 * Redirects to /login if the session is invalid and `redirectOnUnauth` is true.
 * Dentro del layout de /app devuelve la sesión del layout sin ir al servidor.
 */
export function useSession(redirectOnUnauth = false): SessionState {
  const router = useRouter();
  const provided = useContext(SessionContext);
  const [state, setState] = useState<SessionState>({
    status: "loading",
    session: null,
    error: null,
  });
  const fromLayout = useMemo<SessionState | null>(
    () => (provided ? { status: "authenticated", session: provided, error: null } : null),
    [provided],
  );

  useEffect(() => {
    if (provided) return;
    let cancelled = false;
    apiFetch("/api/auth/session")
      .then(async (r) => {
        if (!r.ok) {
          if (cancelled) return;
          if (redirectOnUnauth) {
            router.replace("/login");
          }
          setState({ status: "unauthenticated", session: null, error: null });
          return null;
        }
        return r.json();
      })
      .then((payload) => {
        if (cancelled || !payload) return;
        // Usar unwrapApiData para soportar contrato estándar { ok, data }
        const data = unwrapApiData(payload as ApiResponse<{ authenticated: boolean; user: SessionPayload }>);
        if (data.authenticated && data.user) {
          const session: SessionPayload = {
            ...data.user,
            sessionVersion: data.user.sessionVersion ?? 0,
            exp: data.user.exp ?? Math.floor(Date.now() / 1000) + 3600,
          };
          setState({ status: "authenticated", session, error: null });
        } else {
          if (redirectOnUnauth) {
            router.replace("/login");
          }
          setState({ status: "unauthenticated", session: null, error: null });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error", session: null, error: "Failed to fetch session" });
      });
    return () => {
      cancelled = true;
    };
  }, [provided, redirectOnUnauth, router]);

  return fromLayout ?? state;
}
