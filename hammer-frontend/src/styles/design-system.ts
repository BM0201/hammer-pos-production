/**
 * H.A.M.M.E.R. Design System
 * Unified design tokens for consistent UI across the application.
 */

export const colors = {
  primary: {
    50: "#eff6ff",
    100: "#dbeafe",
    200: "#bfdbfe",
    300: "#93c5fd",
    400: "#60a5fa",
    500: "#3b82f6",
    600: "#2563eb",
    700: "#1d4ed8",
    800: "#1e40af",
    900: "#1e3a8a",
    DEFAULT: "#3b82f6",
  },
  success: {
    50: "#f0fdf4",
    100: "#dcfce7",
    200: "#bbf7d0",
    500: "#22c55e",
    600: "#16a34a",
    700: "#15803d",
    DEFAULT: "#10b981",
  },
  warning: {
    50: "#fffbeb",
    100: "#fef3c7",
    500: "#f59e0b",
    600: "#d97706",
    DEFAULT: "#f59e0b",
  },
  danger: {
    50: "#fef2f2",
    100: "#fee2e2",
    500: "#ef4444",
    600: "#dc2626",
    700: "#b91c1c",
    DEFAULT: "#ef4444",
  },
  neutral: {
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    300: "#d1d5db",
    400: "#9ca3af",
    500: "#6b7280",
    600: "#4b5563",
    700: "#374151",
    800: "#1f2937",
    900: "#111827",
  },
} as const;

export const spacing = {
  xs: "0.25rem",
  sm: "0.5rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
  "2xl": "3rem",
} as const;

export const typography = {
  h1: "text-3xl font-bold text-[var(--color-text)]",
  h2: "text-2xl font-semibold text-[var(--color-text)]",
  h3: "text-xl font-semibold text-[var(--color-text-secondary)]",
  h4: "text-lg font-medium text-[var(--color-text-secondary)]",
  body: "text-base text-[var(--color-text-muted)]",
  small: "text-sm text-[var(--color-text-muted)]",
  muted: "text-sm text-[var(--color-text-soft)]",
} as const;

export const components = {
  button: {
    base: "inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] min-w-[44px]",
    primary: "bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] text-white focus:ring-[var(--color-info-500)] active:bg-[var(--color-info-800)]",
    secondary: "bg-[var(--color-surface-alt)] hover:bg-[var(--color-border)] text-[var(--color-text)] focus:ring-[var(--color-text-soft)] border border-[var(--color-border)]",
    danger: "bg-[var(--color-danger-600)] hover:bg-[var(--color-danger-700)] text-white focus:ring-[var(--color-danger-500)]",
    success: "bg-[var(--color-success-600)] hover:bg-[var(--color-success-700)] text-white focus:ring-[var(--color-success-500)]",
    ghost: "bg-transparent hover:bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] focus:ring-[var(--color-text-soft)]",
    sizes: {
      sm: "px-3 py-1.5 text-sm gap-1.5",
      md: "px-4 py-2.5 text-sm gap-2",
      lg: "px-6 py-3 text-base gap-2.5",
    },
  },
  card: {
    base: "bg-[var(--color-surface)] rounded-xl shadow-[var(--shadow-card)] border border-[var(--color-border)]",
    elevated: "bg-[var(--color-surface)] rounded-xl shadow-md",
    outlined: "bg-[var(--color-surface)] rounded-xl border-2 border-[var(--color-border-strong)]",
    padding: "p-6",
  },
  input: {
    base: "hm-input",
    error: "border-[var(--color-danger-500)] focus:ring-[var(--color-danger-500)] focus:border-[var(--color-danger-500)]",
    disabled: "bg-[var(--color-surface-alt)] text-[var(--color-text-soft)] cursor-not-allowed",
  },
  table: {
    wrapper: "overflow-x-auto -mx-6 px-6",
    base: "hm-table",
    head: "bg-[var(--color-surface-alt)] text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider",
    headCell: "px-4 py-3",
    body: "divide-y divide-[var(--color-border)]",
    row: "hover:bg-[var(--color-surface-alt)] transition-colors",
    cell: "px-4 py-3 text-sm text-[var(--color-text-muted)]",
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
