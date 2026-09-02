/**
 * H.A.M.M.E.R. Design System
 * Unified design tokens for consistent UI across the application.
 */

export const components = {
  button: {
    base: "inline-flex items-center justify-center font-semibold rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none min-h-[42px] min-w-[42px] active:scale-[0.98]",
    primary: "bg-[var(--color-info-700)] hover:bg-[var(--color-info-600)] text-white focus:ring-[var(--color-info-500)] shadow-md shadow-blue-900/15 hover:shadow-lg hover:shadow-blue-900/20",
    secondary: "bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)] text-[var(--color-text)] focus:ring-[var(--color-text-soft)] border-[1.5px] border-[var(--color-border)] shadow-sm hover:shadow-md hover:border-[var(--color-border-strong)]",
    danger: "bg-[var(--color-danger-600)] hover:bg-[var(--color-danger-700)] text-white focus:ring-[var(--color-danger-500)] shadow-md shadow-red-900/15 hover:shadow-lg hover:shadow-red-900/20",
    success: "bg-[var(--color-success-600)] hover:bg-[var(--color-success-700)] text-white focus:ring-[var(--color-success-500)] shadow-md shadow-green-900/15 hover:shadow-lg hover:shadow-green-900/20",
    ghost: "bg-transparent hover:bg-[var(--color-surface-alt)] text-[var(--color-text-secondary)] focus:ring-[var(--color-text-soft)]",
    sizes: {
      sm: "px-3 py-1.5 text-sm gap-1.5",
      md: "px-4 py-2.5 text-sm gap-2",
      lg: "px-6 py-3 text-base gap-2.5",
    },
  },
  card: {
    base: "bg-[var(--color-surface)] rounded-xl shadow-[var(--shadow-card)] border border-[var(--color-border)]",
    elevated: "bg-[var(--color-surface)] rounded-xl shadow-[var(--shadow-lg)] border border-[var(--color-border)]",
    outlined: "bg-[var(--color-surface)] rounded-xl border-[1.5px] border-[var(--color-border-strong)]",
    padding: "p-5",
  },
  input: {
    base: "hm-input",
    error: "border-[var(--color-danger-500)] focus:ring-[var(--color-danger-500)] focus:border-[var(--color-danger-500)]",
    disabled: "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] cursor-not-allowed",
  },
  table: {
    wrapper: "overflow-x-auto -mx-5 px-5",
    base: "hm-table",
    head: "bg-[var(--color-surface-alt)] text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider",
    headCell: "px-4 py-3",
    body: "divide-y divide-[var(--color-border)]",
    row: "hover:bg-[var(--color-surface-alt)] transition-colors",
    cell: "px-4 py-3 text-sm text-[var(--color-text-secondary)]",
  },
  badge: {
    base: "hm-badge",
    variants: {
      success: "hm-badge-success",
      warning: "hm-badge-warning",
      danger: "hm-badge-danger",
      info: "hm-badge-info",
      neutral: "hm-badge-neutral",
    },
  },
} as const;
