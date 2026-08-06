import type { ReactNode } from "react";
import { PackageOpen } from "lucide-react";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Optional tone for the icon ring — matches semantic colors */
  tone?: "default" | "info" | "success" | "warning";
};

const TONE_ICON_BG: Record<string, string> = {
  default: "bg-[var(--color-surface-alt)] border-[var(--color-border)] text-[var(--color-text-muted)]",
  info:    "bg-[var(--color-info-50)]    border-[var(--color-info-100)]    text-[var(--color-info-600)]",
  success: "bg-[var(--color-success-50)] border-[var(--color-success-100)] text-[var(--color-success-600)]",
  warning: "bg-[var(--color-warning-50)] border-[var(--color-warning-100)] text-[var(--color-warning-600)]",
};

export function EmptyState({ icon, title, description, action, tone = "default" }: EmptyStateProps) {
  const iconStyle = TONE_ICON_BG[tone] ?? TONE_ICON_BG.default;

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] px-6 py-14 text-center animate-fade-in">
      {/* Icon container — gradient circle */}
      <div className={`mb-5 flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-sm ${iconStyle}`}>
        <span className="[&>svg]:h-7 [&>svg]:w-7">
          {icon ?? <PackageOpen />}
        </span>
      </div>

      <h3 className="mb-1.5 text-[1.0625rem] font-bold text-[var(--color-text)] tracking-tight">
        {title}
      </h3>

      {description && (
        <p className="mb-6 max-w-sm text-sm leading-relaxed text-[var(--color-text-muted)]">
          {description}
        </p>
      )}

      {action && (
        <div className="flex flex-wrap justify-center gap-2">{action}</div>
      )}
    </div>
  );
}
