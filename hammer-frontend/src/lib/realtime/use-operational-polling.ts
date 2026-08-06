"use client";

import { useCallback, useEffect, useRef } from "react";

type UseOperationalPollingInput = {
  task: () => Promise<void>;
  intervalMs?: number;
  enabled?: boolean;
  onError?: (error: unknown) => void;
  deps?: ReadonlyArray<unknown>;
  immediate?: boolean;
  /**
   * When true, runs even if the tab is hidden (document.hidden).
   * Use only for truly critical tasks (e.g. cash session status that must
   * stay current). Most screens should leave this false.
   */
  critical?: boolean;
};

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
const FOCUS_REFRESH_GAP_MS = 5_000;

/** Adds ±15 % jitter to avoid thundering-herd from multiple hooks at once. */
function withJitter(ms: number): number {
  return ms * (0.85 + Math.random() * 0.3);
}

export function useOperationalPolling({
  task,
  intervalMs = 8000,
  enabled = true,
  onError,
  deps = [],
  immediate = true,
  critical = false,
}: UseOperationalPollingInput) {
  // Stable refs — updated on every render so callbacks always see fresh values
  // without being recreated themselves.
  const taskRef = useRef(task);
  const onErrorRef = useRef(onError);
  const criticalRef = useRef(critical);
  taskRef.current = task;
  onErrorRef.current = onError;
  criticalRef.current = critical;

  const isRunning = useRef(false);
  const consecutiveErrors = useRef(0);
  const lastRunAt = useRef(0);
  const timerId = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);

  const run = useCallback(async (fromFocusEvent = false) => {
    if (cancelled.current) return;
    if (isRunning.current) return;

    if (fromFocusEvent) {
      const msSinceLast = Date.now() - lastRunAt.current;
      if (msSinceLast < FOCUS_REFRESH_GAP_MS) return;
    }

    if (!criticalRef.current && typeof document !== "undefined" && document.hidden) return;

    isRunning.current = true;
    lastRunAt.current = Date.now();
    try {
      await taskRef.current();
      consecutiveErrors.current = 0;
    } catch (error) {
      consecutiveErrors.current += 1;
      onErrorRef.current?.(error);
    } finally {
      isRunning.current = false;
    }
  }, []); // stable — never recreated

  useEffect(() => {
    if (!enabled) return;

    cancelled.current = false;
    consecutiveErrors.current = 0;
    lastRunAt.current = 0;

    function scheduleNext() {
      if (cancelled.current) return;
      const backoffFactor = Math.min(consecutiveErrors.current, 6);
      const backoff = consecutiveErrors.current > 0
        ? Math.min(BASE_BACKOFF_MS * 2 ** backoffFactor, MAX_BACKOFF_MS)
        : 0;
      const delay = withJitter(intervalMs) + backoff;
      timerId.current = setTimeout(() => {
        void run(false).then(scheduleNext);
      }, delay);
    }

    if (immediate) {
      void run(false).then(scheduleNext);
    } else {
      scheduleNext();
    }

    function onFocus() {
      void run(true);
    }

    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
    }

    return () => {
      cancelled.current = true;
      if (timerId.current !== null) clearTimeout(timerId.current);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, immediate, critical, run, ...deps]);
}
