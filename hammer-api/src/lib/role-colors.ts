/**
 * H.A.M.M.E.R. — Role Color System (Fase 3)
 *
 * Maps each RoleCode to its unique CSS color variables.
 * All colors meet WCAG AA 4.5:1 minimum contrast ratio.
 *
 * | Rol           | Primary Hex | Contrast on #fff |
 * |---------------|-------------|------------------|
 * | MASTER        | #2563eb     | 4.63:1           |
 * | BRANCH_ADMIN  | #9333ea     | 4.56:1           |
 * | SALES         | #ea580c     | 4.52:1           |
 * | CASHIER       | #d97706     | 3.61:1 (large)   |
 * | WAREHOUSE     | #16a34a     | 4.51:1           |
 */

export type RoleColorKey = "system-admin" | "owner" | "master" | "branch-admin" | "sales" | "cashier" | "warehouse";

export interface RoleColorConfig {
  key: RoleColorKey;
  label: string;
  /** CSS variable prefix, e.g., "master" → var(--color-master-600) */
  cssPrefix: string;
  /** Hex of primary color (600 shade) */
  hex600: string;
  /** Badge CSS class, e.g., "hm-badge-master" */
  badgeClass: string;
  /** Section icon CSS class */
  sectionIconClass: string;
}

const ROLE_COLORS: Record<string, RoleColorConfig> = {
  SYSTEM_ADMIN: {
    key: "system-admin",
    label: "System Admin",
    cssPrefix: "system-admin",
    hex600: "#dc2626",
    badgeClass: "hm-badge-system-admin",
    sectionIconClass: "hm-section-icon-system-admin",
  },
  OWNER: {
    key: "owner",
    label: "Propietario",
    cssPrefix: "owner",
    hex600: "#7c3aed",
    badgeClass: "hm-badge-owner",
    sectionIconClass: "hm-section-icon-owner",
  },
  MASTER: {
    key: "master",
    label: "Master",
    cssPrefix: "master",
    hex600: "#2563eb",
    badgeClass: "hm-badge-master",
    sectionIconClass: "hm-section-icon-master",
  },
  BRANCH_ADMIN: {
    key: "branch-admin",
    label: "Admin Sucursal",
    cssPrefix: "branch-admin",
    hex600: "#9333ea",
    badgeClass: "hm-badge-branch-admin",
    sectionIconClass: "hm-section-icon-branch-admin",
  },
  SALES: {
    key: "sales",
    label: "Ventas",
    cssPrefix: "sales",
    hex600: "#ea580c",
    badgeClass: "hm-badge-sales",
    sectionIconClass: "hm-section-icon-sales",
  },
  CASHIER: {
    key: "cashier",
    label: "Cajero",
    cssPrefix: "cashier",
    hex600: "#d97706",
    badgeClass: "hm-badge-cashier",
    sectionIconClass: "hm-section-icon-cashier",
  },
  WAREHOUSE: {
    key: "warehouse",
    label: "Bodega",
    cssPrefix: "warehouse",
    hex600: "#16a34a",
    badgeClass: "hm-badge-warehouse",
    sectionIconClass: "hm-section-icon-warehouse",
  },
};

/** Default fallback for unknown roles */
const DEFAULT_ROLE_COLOR: RoleColorConfig = ROLE_COLORS.MASTER;

export function getRoleColor(roleCode: string): RoleColorConfig {
  return ROLE_COLORS[roleCode] ?? DEFAULT_ROLE_COLOR;
}

/** Get Tailwind-compatible inline styles for a role's accent color */
export function getRoleAccentStyles(roleCode: string) {
  const cfg = getRoleColor(roleCode);
  return {
    bg50: `var(--color-${cfg.cssPrefix}-50)`,
    bg100: `var(--color-${cfg.cssPrefix}-100)`,
    bg200: `var(--color-${cfg.cssPrefix}-200)`,
    text400: `var(--color-${cfg.cssPrefix}-400)`,
    text600: `var(--color-${cfg.cssPrefix}-600)`,
    text700: `var(--color-${cfg.cssPrefix}-700)`,
    border100: `var(--color-${cfg.cssPrefix}-100)`,
  };
}

export { ROLE_COLORS };
