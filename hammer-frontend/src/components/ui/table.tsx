"use client";
import type { ReactNode } from "react";
import { components } from "@/styles/design-system";

export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={components.table.wrapper}>
      <table className={`${components.table.base} ${className}`}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className={components.table.head}>{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className={components.table.body}>{children}</tbody>;
}

export function TR({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tr className={`${components.table.row} ${className}`}>{children}</tr>;
}

export function TH({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <th className={`${components.table.headCell} ${className}`}>{children}</th>;
}

export function TD({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`${components.table.cell} ${className}`}>{children}</td>;
}
