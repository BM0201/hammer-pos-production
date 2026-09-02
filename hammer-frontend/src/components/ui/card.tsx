"use client";
import type { HTMLAttributes, ReactNode } from "react";
import { components } from "@/styles/design-system";

type CardVariant = "base" | "elevated" | "outlined";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  noPadding?: boolean;
  children: ReactNode;
}

export function Card({ variant = "base", noPadding, children, className = "", ...props }: CardProps) {
  const variantClass = components.card[variant];
  return (
    <div className={`${variantClass} ${noPadding ? "" : components.card.padding} ${className}`} {...props}>
      {children}
    </div>
  );
}

