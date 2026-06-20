import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
};

export function PageHeader({ title, description, actions, breadcrumbs }: PageHeaderProps) {
  return (
    <div className="hm-page-band mb-5 relative">
      {/* Gradient accent line at bottom of band */}
      <div className="hm-accent-bar absolute bottom-0 left-5 right-5 lg:left-8 lg:right-8" />

      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-3 flex flex-wrap items-center gap-1" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, i) => (
            <span key={`${crumb.label}-${i}`} className="flex items-center gap-1">
              {crumb.href ? (
                <Link
                  href={crumb.href as Route}
                  className="hm-chip text-[0.6875rem] hover:text-[var(--color-master-700)] hover:border-[var(--color-master-100)] hover:bg-[var(--color-master-50)]"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="hm-chip text-[0.6875rem] font-semibold bg-[var(--color-master-50)] text-[var(--color-master-700)] border-[var(--color-master-100)]">
                  {crumb.label}
                </span>
              )}
              {i < breadcrumbs.length - 1 && (
                <span className="text-[0.625rem] text-[var(--color-text-soft)] select-none">›</span>
              )}
            </span>
          ))}
        </nav>
      )}

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
