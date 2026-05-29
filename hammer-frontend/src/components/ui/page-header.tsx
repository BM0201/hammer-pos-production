import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
};

export function PageHeader({ title, description, actions, breadcrumbs }: PageHeaderProps) {
  return (
    <div className="hm-page-band mb-5">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-3 flex flex-wrap items-center gap-1 text-xs text-[var(--color-text-muted)]">
          {breadcrumbs.map((crumb, i) => (
            <span key={`${crumb.label}-${i}`} className="flex items-center gap-1.5">
              {crumb.href ? (
                <a href={crumb.href} className="rounded-md px-1.5 py-1 transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]">
                  {crumb.label}
                </a>
              ) : (
                <span className="rounded-md bg-[var(--color-surface-alt)] px-1.5 py-1 font-medium text-[var(--color-text)]">{crumb.label}</span>
              )}
              {i < breadcrumbs.length - 1 && <span className="text-[var(--color-text-soft)]">/</span>}
            </span>
          ))}
        </nav>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">{title}</h1>
          {description && (
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
