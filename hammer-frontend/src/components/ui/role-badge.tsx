"use client";

import { getRoleColor } from "@/lib/role-colors";

type RoleBadgeProps = {
  roleCode: string;
  size?: "sm" | "md";
  className?: string;
};

/**
 * RoleBadge — Displays a role badge with unique WCAG-AA-compliant color.
 * Each of the 5 roles gets its own distinctive color.
 */
export function RoleBadge({ roleCode, size = "sm", className = "" }: RoleBadgeProps) {
  const cfg = getRoleColor(roleCode);

  const sizeClasses = size === "md"
    ? "text-xs px-3 py-0.5"
    : "text-[0.625rem] px-2 py-0.5";

  return (
    <span
      className={`${cfg.badgeClass} hm-badge ${sizeClasses} ${className}`}
    >
      {cfg.label}
    </span>
  );
}
