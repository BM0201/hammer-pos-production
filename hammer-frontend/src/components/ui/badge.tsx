"use client";
import type { ReactNode } from "react";
import { components } from "@/styles/design-system";

type BadgeVariant = "success" | "warning" | "danger" | "info" | "neutral";

export function Badge({
  variant = "neutral",
  children,
  className = "",
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`${components.badge.base} ${components.badge.variants[variant]} ${className}`}>
      {children}
    </span>
  );
}
