"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftCircle, CreditCard, LogOut, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "@/components/ui/role-badge";

/**
 * POS Shell — POS-focused topbar/content wrapper.
 * Can run standalone or integrated inside the shared App shell + sidebar.
 */
export function PosShellWrapper({
  children,
  username,
  roleCode,
  mode = "sales",
  integrated = false,
  exitHref = "/app/branch",
}: {
  children: ReactNode;
  username: string;
  roleCode: string;
  mode?: "sales" | "cashier";
  integrated?: boolean;
  exitHref?: string;
}) {
  const modeTitle = mode === "cashier" ? "Caja & Cobros" : "Punto de Venta";
  const modeSubtitle = mode === "cashier"
    ? "Cobro operativo y control de caja en tiempo real"
    : "Captura de tickets y envío fluido a caja";
  const ModeIcon = mode === "cashier" ? CreditCard : ShoppingCart;

  return (
    <div className={`flex ${integrated ? "min-h-0" : "min-h-screen"} flex-col bg-[var(--color-page-bg)] ${integrated ? "min-w-0" : ""}`}>
      <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-sm">
        <div className="flex h-14 items-center justify-between px-5 lg:px-8">
          <div className="flex items-center gap-3">
            <ModeIcon className="h-4 w-4 text-[var(--color-text-soft)]" />
            <div>
              <p className="text-sm font-semibold tracking-tight text-[var(--color-text)]">{modeTitle}</p>
              <p className="text-[0.7rem] text-[var(--color-text-muted)]">{modeSubtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href={exitHref as any}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--color-text-soft)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"
              title="Volver a módulos"
            >
              <ArrowLeftCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Módulos</span>
            </Link>
            <RoleBadge roleCode={roleCode} size="sm" />
            <span className="hidden sm:block text-xs text-[var(--color-text-muted)]">{username}</span>
            <form action="/api/auth/logout" method="post">
              <Button
                variant="ghost"
                size="sm"
                type="submit"
                title="Cerrar sesión"
                className="text-[var(--color-text-soft)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-danger-600)]"
                icon={<LogOut className="h-4 w-4" />}
              >
                <span className="hidden sm:inline">Salir</span>
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className={`flex-1 ${integrated ? "p-4 lg:p-5" : "p-5 lg:p-8"}`}>
        {children}
      </main>
    </div>
  );
}
