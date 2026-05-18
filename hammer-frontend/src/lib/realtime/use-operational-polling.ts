"use client";

import { useEffect } from "react";

type UseOperationalPollingInput = {
  task: () => Promise<void>;
  intervalMs?: number;
  enabled?: boolean;
  onError?: (error: unknown) => void;
  deps?: ReadonlyArray<unknown>;
  immediate?: boolean;
};

export function useOperationalPolling({
  task,
  intervalMs = 8000,
  enabled = true,
  onError,
  deps = [],
  immediate = true,
}: UseOperationalPollingInput) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      try {
        await task();
      } catch (error) {
        onError?.(error);
      }
    };

    if (immediate) {
      void run();
    }

    const timer = setInterval(() => {
      if (document.hidden) return;
      void run();
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, immediate, onError, ...deps]);
}
