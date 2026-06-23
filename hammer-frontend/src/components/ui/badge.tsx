"use client";
import type { ReactNode } from "react";
import { components } from "@/styles/design-system";

type BadgeVariant = "success" | "warning" | "danger" | "info" | "neutral";

export function Badge({
  variant = "neutral",
  children,
  className = "",
  title,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
  /** Optional hover tooltip — useful to explain what a status means. */
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`${components.badge.base} ${components.badge.variants[variant]} ${title ? "cursor-help" : ""} ${className}`}
    >
      {children}
    </span>
  );
}
