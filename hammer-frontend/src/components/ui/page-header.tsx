import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
};

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="hm-page-band mb-5 relative">
      {/* Gradient accent line at bottom of band */}
      <div className="hm-accent-bar absolute bottom-0 left-5 right-5 lg:left-8 lg:right-8" />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between pb-3">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] font-extrabold tracking-[-0.03em] text-[var(--color-text)] leading-tight">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--color-text-muted)]">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
    </div>
  );
}
