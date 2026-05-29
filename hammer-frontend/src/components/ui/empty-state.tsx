import type { ReactNode } from "react";
import { PackageOpen } from "lucide-react";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] px-5 py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] shadow-sm">
        {icon ?? <PackageOpen className="h-6 w-6" />}
      </div>
      <h3 className="mb-2 text-base font-semibold text-[var(--color-text)]">{title}</h3>
      {description && (
        <p className="mb-5 max-w-md text-sm leading-6 text-[var(--color-text-muted)]">{description}</p>
      )}
      {action && <div className="flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
