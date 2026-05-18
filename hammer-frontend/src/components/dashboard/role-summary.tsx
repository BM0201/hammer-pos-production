import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { getRoleColor } from "@/lib/role-colors";

export function RoleSummary({
  title,
  subtitle,
  kpis,
  alerts = [],
  quickLinks = [],
  ctaButton,
  accent = "branch",
  roleAccent,
  showHeaderAccent = true,
}: {
  title: string;
  subtitle: string;
  kpis: ReactNode;
  alerts?: string[];
  quickLinks?: Array<{ href: string; label: string; icon?: ReactNode }>;
  /** Prominent CTA button */
  ctaButton?: { label: string; href: string; icon?: ReactNode };
  /** Legacy prop */
  accent?: "master" | "branch";
  /** Role code for accent — preferred over legacy `accent` */
  roleAccent?: string;
  /** Decorative role accent bar on header */
  showHeaderAccent?: boolean;
}) {
  const resolvedRole = roleAccent ?? (accent === "master" ? "MASTER" : "BRANCH_ADMIN");
  const roleCfg = getRoleColor(resolvedRole);

  return (
    <section className="space-y-6 animate-fade-in-up">
      {/* Header with role-colored accent bar */}
      <div>
        <div className={`flex items-center mb-1 ${showHeaderAccent ? "gap-3" : ""}`}>
          {showHeaderAccent ? (
            <div
              className="h-8 w-1 rounded-full"
              style={{
                background: `linear-gradient(to bottom, var(--color-${roleCfg.cssPrefix}-400), var(--color-${roleCfg.cssPrefix}-600))`,
              }}
            />
          ) : null}
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">{title}</h1>
            <p className="text-sm text-[var(--color-text-muted)]">{subtitle}</p>
          </div>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 stagger-children">{kpis}</div>

      {/* CTA Button */}
      {ctaButton && (
        <div className="flex justify-center">
          <Link
            href={ctaButton.href as any}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-white font-semibold text-sm shadow-md hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5"
            style={{
              background: `linear-gradient(135deg, var(--color-${roleCfg.cssPrefix}-500), var(--color-${roleCfg.cssPrefix}-700))`,
            }}
          >
            {ctaButton.icon}
            {ctaButton.label}
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {/* Alerts */}
      {alerts.length > 0 ? (
        <div className="flex items-start gap-3 p-4 rounded-lg border-l-4 border-[var(--color-warning-500)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold mb-1">Alertas operativas</p>
            <ul className="space-y-0.5 list-disc pl-4 text-sm">
              {alerts.map((alert) => (
                <li key={alert}>{alert}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 p-4 rounded-lg border-l-4 border-[var(--color-success-500)] bg-[var(--color-success-50)] text-[var(--color-success-700)]">
          <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <p className="text-sm font-medium">Sin alertas operativas críticas.</p>
        </div>
      )}

      {/* Quick links as operational cards */}
      {quickLinks.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Accesos rápidos operativos</h2>
            <span className="text-xs text-[var(--color-text-soft)]">{quickLinks.length} módulos</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {quickLinks.map((link) => (
              <Link key={link.href} href={link.href as any}>
                <div className="group flex items-center gap-3 p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:shadow-md hover:border-[var(--color-border-strong)] transition-all duration-200 cursor-pointer">
                  {link.icon && (
                    <div
                      className="flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0 transition-colors"
                      style={{
                        background: `var(--color-${roleCfg.cssPrefix}-50)`,
                        color: `var(--color-${roleCfg.cssPrefix}-600)`,
                      }}
                    >
                      {link.icon}
                    </div>
                  )}
                  <span className="flex-1 text-sm font-semibold text-[var(--color-text)] group-hover:text-[var(--color-text)]">
                    {link.label}
                  </span>
                  <ChevronRight className="h-4 w-4 text-[var(--color-text-soft)] group-hover:text-[var(--color-text-muted)] transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
