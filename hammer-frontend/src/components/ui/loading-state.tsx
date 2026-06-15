type LoadingStateProps = {
  message?: string;
  /** Show skeleton cards instead of centered spinner */
  skeleton?: boolean;
  /** Number of skeleton cards to show */
  count?: number;
};

function SkeletonCard() {
  return (
    <div className="hm-skeleton-card">
      <div className="flex items-start gap-3">
        <div className="hm-skeleton-block hm-skeleton-circle h-10 w-10 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="hm-skeleton-line" style={{ width: "55%" }} />
          <div className="hm-skeleton-line hm-skeleton-line-sm" style={{ width: "80%" }} />
        </div>
      </div>
      <div className="hm-skeleton-line hm-skeleton-line-lg" />
      <div className="space-y-2">
        <div className="hm-skeleton-line" style={{ width: "90%" }} />
        <div className="hm-skeleton-line" style={{ width: "70%" }} />
      </div>
    </div>
  );
}

export function LoadingState({ message = "Cargando...", skeleton, count = 3 }: LoadingStateProps) {
  if (skeleton) {
    return (
      <div className={`grid gap-4 ${count === 1 ? "" : count === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
        {Array.from({ length: count }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-14 shadow-sm">
      {/* Spinner */}
      <div className="relative mb-5">
        <div className="h-11 w-11 rounded-full border-[3px] border-[var(--color-border)] animate-spin border-t-[var(--color-info-600)]" />
        <div
          className="absolute inset-1.5 rounded-full border-[2px] border-transparent animate-spin border-r-[var(--color-info-200)]"
          style={{ animationDuration: "0.75s", animationDirection: "reverse" }}
        />
      </div>
      <p className="text-sm font-medium text-[var(--color-text-muted)] animate-pulse-soft">
        {message}
      </p>
    </div>
  );
}

/** Convenience: full-page skeleton KPI grid */
export function KpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="hm-kpi-grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="hm-kpi-tile">
          <div className="absolute top-0 left-0 right-0 h-[3px] hm-skeleton-block" />
          <div className="flex items-start justify-between gap-3 mt-0.5">
            <div className="flex-1 space-y-2">
              <div className="hm-skeleton-line" style={{ width: "50%" }} />
              <div className="hm-skeleton-line hm-skeleton-line-xl" style={{ width: "70%" }} />
              <div className="hm-skeleton-line hm-skeleton-line-sm" style={{ width: "60%" }} />
            </div>
            <div className="hm-skeleton-block rounded-xl" style={{ width: "2.5rem", height: "2.5rem" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
