"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client/api";

// Refs espejo: mantienen el efecto atado solo a `branchId`, si no se
// recrea en cada navegación y dispara un heartbeat extra por página.
export function useAuthHeartbeat({
  branchId,
  currentModule,
}: {
  branchId?: string | null;
  currentModule: string;
}): void {
  const router = useRouter();
  const pathname = usePathname();

  const pathnameRef = useRef(pathname);
  const moduleRef = useRef(currentModule);
  pathnameRef.current = pathname;
  moduleRef.current = currentModule;

  useEffect(() => {
    let stopped = false;
    let lastBeat = 0;

    const sendHeartbeat = async () => {
      try {
        const response = await apiFetch("/api/auth/heartbeat", {
          method: "POST",
          body: JSON.stringify({
            branchId,
            currentPath: pathnameRef.current,
            currentModule: moduleRef.current,
          }),
        });
        if (!stopped && response.status === 401) router.replace("/login");
      } catch {
        /* presence is best-effort */
      }
    };

    const maybeSend = (minGapMs = 0) => {
      if (stopped || document.hidden) return;
      if (Date.now() - lastBeat < minGapMs) return;
      lastBeat = Date.now();
      void sendHeartbeat();
    };

    maybeSend();
    const interval = window.setInterval(() => maybeSend(), 120_000);
    const onFocus = () => maybeSend(5_000);
    window.addEventListener("focus", onFocus);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [router, branchId]);
}
