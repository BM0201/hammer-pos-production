"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useSearchParams } from "next/navigation";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { INVENTORY_NAV_SECTIONS } from "@/components/inventory/inventory-nav";

/**
 * prompt-inventario-v3.md Fase 2.1 — navegación lateral local de la
 * sección Inventario (no reemplaza el sidebar global de la app — este
 * vive DENTRO de /app/master/inventory/*, el mismo patrón que otras
 * secciones con su propia sub-navegación).
 */
function isActiveHref(pathname: string, search: string, href: string): boolean {
  const [hrefPath, hrefQuery] = href.split("?");
  if (pathname !== hrefPath) return false;
  if (!hrefQuery) return true;
  return new URLSearchParams(search).get("tab") === new URLSearchParams(hrefQuery).get("tab");
}

export function InventoryLocalNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendientesCount, setPendientesCount] = useState<number | null>(null);

  useEffect(() => {
    apiFetch("/api/master/inventory/quality")
      .then((res) => res.json())
      .then((raw) => {
        const counts = unwrapApiData(raw) as { noCost: number; noPrice: number; noCode: number; costEqualsPrice: number; noCategory: number };
        setPendientesCount(counts.noCost + counts.noPrice + counts.noCode + counts.costEqualsPrice + counts.noCategory);
      })
      .catch(() => {});
  }, []);

  return (
    <nav className="w-full shrink-0 space-y-4 overflow-x-auto md:w-56 md:overflow-visible">
      <div className="flex gap-1 md:block md:space-y-4">
        {INVENTORY_NAV_SECTIONS.map((section, sectionIdx) => (
          <div key={section.title || sectionIdx} className="shrink-0 md:shrink">
            {section.title ? (
              <p className="mb-1 px-2 text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{section.title}</p>
            ) : null}
            <div className="flex gap-1 md:flex-col md:gap-0.5">
              {section.items.map((item, itemIdx) => {
                const active = isActiveHref(pathname, searchParams.toString(), item.href);
                const Icon = item.icon;
                const badge = item.badgeKey === "pendientes" ? pendientesCount : null;
                return (
                  <Link
                    key={`${item.href}-${itemIdx}`}
                    href={item.href as Route}
                    className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "bg-[var(--color-master-50)] text-[var(--color-master-700)]"
                        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                    {badge !== null && badge > 0 ? (
                      <span className="ml-auto rounded-full bg-[var(--color-warning-100)] px-1.5 py-0.5 text-[0.65rem] font-semibold text-[var(--color-warning-700)]">{badge}</span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}
