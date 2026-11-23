"use client";

import type { Route } from "next";
import Link from "next/link";
import type { ElementType } from "react";
import {
  AlarmClock,
  Building2,
  Calculator,
  ChevronRight,
  Clock,
  Layers,
  PiggyBank,
  Printer,
  Receipt,
  ScanBarcode,
  Settings,
  SlidersHorizontal,
  TreePine,
  Users,
  Wallet,
} from "lucide-react";
import { ExchangeRatePanel } from "@/components/treasury/exchange-rate-panel";
import { useSession } from "@/lib/client/session";
import { isOwnerRole, isSystemAdminRole } from "@/modules/rbac/role-routing";

type Item = { href: string; label: string; description: string; icon: ElementType };
type Group = { title: string; items: Item[]; ownerOnly?: boolean; sysAdminOnly?: boolean };

/**
 * Configuración — todo lo que se ajusta para todo el sistema, en un solo
 * lugar. El tipo de cambio se fija aquí mismo; el resto abre directo en su
 * editor (cada uno sigue viviendo donde se usa, para no tener dos copias).
 */
const GROUPS: Group[] = [
  {
    title: "Dinero y caja",
    items: [
      { href: "/app/master/treasury#sencillo", label: "Sencillo por sucursal", description: "Con cuánto sencillo abre la caja de cada sucursal.", icon: PiggyBank },
      { href: "/app/master/treasury#politica-de-deposito", label: "Política de depósito", description: "Tope de efectivo acumulado y días máximos antes de depositar, por sucursal.", icon: AlarmClock },
      { href: "/app/master/operations?tab=ajustes", label: "Tolerancia de caja y horario", description: "Diferencia aceptada al cerrar caja y horario de apertura y cierre del negocio.", icon: Clock },
      { href: "/app/master/cash-boxes", label: "Cajas físicas", description: "Gavetas de cada sucursal: crear, activar o desactivar.", icon: Wallet },
    ],
  },
  {
    title: "Ventas y productos",
    items: [
      { href: "/app/master/pricing?tab=config", label: "Precios", description: "Margen mínimo, margen base del precio sugerido, gastos operativos y cuándo un producto entra a la Bandeja.", icon: Calculator },
      { href: "/app/master/timber?tab=config", label: "Madera", description: "Precio por pulgada, general y por sucursal.", icon: TreePine },
    ],
  },
  {
    title: "Personal",
    items: [
      { href: "/app/master/settings/payroll", label: "Nómina", description: "Régimen INSS, prestaciones y salario mínimo, para toda la empresa.", icon: Receipt },
    ],
  },
  {
    title: "Documentos y equipos",
    items: [
      { href: "/app/master/settings/print", label: "Impresión", description: "Tickets, facturas y documentos por sucursal.", icon: Printer },
      { href: "/app/master/settings/scanner-test", label: "Prueba de escáner", description: "Verifica que el lector de códigos responde.", icon: ScanBarcode },
    ],
  },
  {
    title: "Sucursales y módulos",
    ownerOnly: true,
    items: [
      { href: "/app/owner/module-config", label: "Módulos por sucursal", description: "Caja, despacho y forma de cobro de cada sucursal.", icon: Layers },
    ],
  },
  {
    title: "Sistema",
    sysAdminOnly: true,
    items: [
      { href: "/app/system-admin/role-config", label: "Roles y permisos", description: "Qué puede hacer cada rol.", icon: Users },
      { href: "/app/system-admin/settings", label: "Ajustes avanzados", description: "Valores internos del sistema (clave y valor).", icon: SlidersHorizontal },
    ],
  },
];

export default function SettingsHubPage() {
  const sessionState = useSession();
  const role = sessionState.status === "authenticated" ? (sessionState.session.roleCode as string) : "";
  const globals = sessionState.status === "authenticated" ? ((sessionState.session.globalRoles ?? []) as unknown as string[]) : [];
  const isSysAdmin = isSystemAdminRole(role, globals);
  const isOwner = isOwnerRole(role, globals) || isSysAdmin;
  const groups = GROUPS.filter((g) => (!g.ownerOnly || isOwner) && (!g.sysAdminOnly || isSysAdmin));

  return (
    <section className="max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-primary-50)]">
          <Settings className="h-5 w-5 text-[var(--color-primary-600)]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">Configuración</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Todo lo que se ajusta para el sistema completo, en un solo lugar.</p>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--color-text-muted)]">Tipo de cambio</h2>
        <ExchangeRatePanel />
        <p className="text-xs text-[var(--color-text-muted)]">
          Se usa para valorar los dólares contados al cerrar caja y los saldos en USD de Tesorería. Al registrar una tasa, las cajas cerradas sin tasa de días aún sin confirmar se recalculan.
        </p>
      </div>

      {groups.map((group) => (
        <div key={group.title} className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--color-text-muted)]">{group.title}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.items.map(({ href, label, description, icon: Icon }) => (
              <Link
                key={href}
                href={href as Route}
                className="group flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-alt)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-600)]"
              >
                <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[var(--color-text)]">{label}</span>
                  <span className="block text-xs text-[var(--color-text-muted)]">{description}</span>
                </span>
                <ChevronRight aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-soft)] transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </div>
      ))}

      <p className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
        <Building2 aria-hidden className="h-3.5 w-3.5" />
        Crear sucursales y su código y nombre sigue en <Link href="/app/master/branches" className="font-semibold text-[var(--color-pay)] hover:underline">Sucursales</Link>.
      </p>
    </section>
  );
}
