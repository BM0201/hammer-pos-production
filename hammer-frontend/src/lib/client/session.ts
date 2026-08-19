/**
 * Client-side session helpers.
 *
 * Provides hooks for fetching and consuming the authenticated session from
 * /api/auth/session. Session data flows through the layout via React state;
 * this hook is for pages that need it directly without prop-drilling.
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import type { SessionPayload } from "@/types/auth";

export type SessionState =
  | { status: "loading"; session: null; error: null }
  | { status: "authenticated"; session: SessionPayload; error: null }
  | { status: "unauthenticated"; session: null; error: null }
  | { status: "error"; session: null; error: string };

/**
 * Hook that fetches the current session and exposes it as React state.
 * Redirects to /login if the session is invalid and `redirectOnUnauth` is true.
 */
export function useSession(redirectOnUnauth = false): SessionState {
  const router = useRouter();
  const [state, setState] = useState<SessionState>({
    status: "loading",
    session: null,
    error: null,
  });

  useEffect(() => {
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
  }, [redirectOnUnauth, router]);

  return state;
}
