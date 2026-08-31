"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money } from "@/lib/format";
import { Boxes, ExternalLink, Info, Loader2, Save, Search } from "lucide-react";

/**
 * "Ese apartado de Fusiones, es para poner el precio, no es otra pestaña
 * para crear" — a diferencia de Fusión de Inventario (crear fusiones,
 * editar presentaciones/factores, desfusionar, reparar — eso sigue en su
 * propia pantalla, enlazada desde acá), este panel hace UNA sola cosa:
 * poner el costo global de cada presentación de cada fusión.
 *
 * "una nueva linea que sea costo global de fusiones, para que se entienda
 * y no exista problemas con el WAC, basandose solo en eso" — el número
 * que se muestra y edita acá es SIEMPRE globalCost (del canónico para
 * TODAS las presentaciones, derivadas incluidas: canonicalGlobalCost ×
 * factor) — nunca WAC, nunca averageCost, nunca branchCost. Es la misma
 * regla que ya usa el guardado (resolveGlobalCostWriteTarget, catalog/
 * service.ts) mirada desde la lectura (computeFusionMemberGlobalCost,
 * stock-group-crud.ts) — una sola fuente, sin la cascada que confundió
 * los casos de piedrín y arena.
 */

type FusionPricingMember = {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  saleUnit: string;
  conversionFactor: number;
  isCanonical: boolean;
  isPackagePresentation?: boolean;
  globalCost: number | null;
  standardSalePrice: number;
  marginPercent: number | null;
};

type FusionPricingGroup = {
  id: string;
  code: string;
  name: string;
  baseUnit: string;
  members: FusionPricingMember[];
};

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

function marginBadgeVariant(value: number | null) {
  if (value === null) return "neutral" as const;
  if (value < 0) return "danger" as const;
  if (value < 20) return "warning" as const;
  return "success" as const;
}

export function FusionPricingPanel() {
  const [groups, setGroups] = useState<FusionPricingGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inventory/stock-groups");
      const raw = await readJson(res);
      const list: FusionPricingGroup[] = unwrapApiData(raw) ?? [];
      setGroups(Array.isArray(list) ? list : []);
      setDraft((prev) => {
        const next = { ...prev };
        for (const group of list) {
          for (const member of group.members) {
            // Se conserva lo que el usuario está tecleando y todavía no
            // guardó; si coincide con el servidor, se toma el del servidor
            // (ya actualizado) — mismo criterio que Precios y costos.
            const serverValue = member.globalCost != null ? String(member.globalCost) : "";
            if (next[member.productId] === undefined || next[member.productId] === serverValue) {
              next[member.productId] = serverValue;
            }
          }
        }
        return next;
      });
    } catch {
      showToast("error", "No se pudieron cargar las fusiones.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) => g.name.toLowerCase().includes(q) || g.code.toLowerCase().includes(q) || g.members.some((m) => m.sku.toLowerCase().includes(q) || m.productName.toLowerCase().includes(q)),
    );
  }, [groups, search]);

  async function saveCost(member: FusionPricingMember, value: string, allowHighUnitCost = false) {
    const numeric = value.trim() === "" ? null : Number(value);
    if (numeric !== null && (!Number.isFinite(numeric) || numeric < 0)) {
      showToast("error", "El costo no puede ser negativo.");
      return;
    }
    const key = member.productId;
    setSavingKey(key);
    try {
      const res = await apiFetch(`/api/catalog/products/${member.productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ globalCost: numeric, allowHighUnitCost: allowHighUnitCost || undefined }),
      });
      if (!res.ok) {
        const raw = await readJson(res);
        // "el ultimo costo que se meta es el que gana en las fusiones...
        // con las derivadas y la factorización equivalente al producto se
        // ajuste" — el backend (resolveGlobalCostWriteTarget) ya convierte
        // y redirige al canónico solo; acá no hace falta saber si `member`
        // es derivado o no, se manda tal cual se escribió en SU fila.
        if (raw?.error?.code === "SUSPECTED_PACKAGE_COST_AS_UNIT_COST") {
          const confirmed = window.confirm(`${raw.error.message}\n\n¿Confirmás que el costo es correcto tal cual lo escribiste?`);
          if (confirmed) { await saveCost(member, value, true); return; }
          return;
        }
        showToast("error", raw?.error?.message ?? "No se pudo guardar el costo.");
        return;
      }
      showToast("success", `Costo global actualizado para ${member.sku}${!member.isCanonical ? " (aplicado al producto canónico)" : ""}.`);
      await load();
    } catch {
      showToast("error", "Error de red al guardar.");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[var(--color-text)]">Fusiones — costo global</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Poné el costo de compra de cada presentación. Se calcula solo con el costo global del canónico y el factor de la fusión — nunca con el WAC.</p>
        </div>
        <span className="flex-1" />
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-soft)]">
          <Search className="h-4 w-4" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar fusión, SKU o producto…"
            className="w-56 bg-transparent outline-none placeholder:text-[var(--color-text-soft)]"
          />
        </div>
        {/* "no es otra pestaña para crear" — crear fusiones nuevas, corregir
            factores/unidades, desfusionar o reparar sigue viviendo en su
            propia pantalla; acá solo se enlaza. */}
        <Link href="/app/master/inventory-fusion" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]">
          <ExternalLink className="h-3.5 w-3.5" /> Crear o editar la estructura de una fusión
        </Link>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-[var(--color-info-200)] bg-[var(--color-info-50)] px-3 py-2 text-xs text-[var(--color-info-700)]">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <p>
          El costo de una presentación derivada (ej. quintal, metro) SIEMPRE sale del costo global del producto canónico
          (ej. varilla, lata) multiplicado por el factor de la fusión — nunca se guarda un costo propio en el derivado.
          Poné el costo en cualquier fila y se ajusta solo: si editás el derivado, el sistema convierte y aplica el
          resultado al canónico automáticamente.
        </p>
      </div>

      {loading ? (
        <Card><div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Cargando…</div></Card>
      ) : filteredGroups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Boxes />}
            title={groups.length === 0 ? "Sin fusiones todavía" : "Ninguna fusión coincide con la búsqueda"}
            description={groups.length === 0 ? "Creá la primera fusión desde \"Crear o editar la estructura de una fusión\"." : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredGroups.map((group) => (
            <Card key={group.id} noPadding>
              <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 py-2.5">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--color-text)]">{group.name}</h2>
                  <span className="font-mono text-[10.5px] text-[var(--color-text-muted)]">{group.code} · base: {group.baseUnit.toLowerCase()}</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="hm-sheet-table">
                  <thead>
                    <tr>
                      <th>Presentación</th>
                      <th>Equivale a</th>
                      <th className="r">Costo global</th>
                      <th className="r">Precio general</th>
                      <th className="r">Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.members.map((member) => {
                      const cell = draft[member.productId] ?? "";
                      const serverValue = member.globalCost != null ? String(member.globalCost) : "";
                      const dirty = cell !== serverValue;
                      const key = member.productId;
                      return (
                        <tr key={member.id}>
                          <td>
                            <div className="font-medium">{member.sku} — {member.productName}</div>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <Badge variant={member.isCanonical ? "info" : "neutral"}>{member.isCanonical ? "canónico" : "derivado"}</Badge>
                              <span className="text-[11px] text-[var(--color-text-muted)]">se vende por {member.saleUnit.toLowerCase()}</span>
                            </div>
                          </td>
                          <td className="text-xs text-[var(--color-text-muted)]">
                            {member.isCanonical ? "unidad base" : `1 ${member.saleUnit.toLowerCase()} = ${member.conversionFactor} ${group.baseUnit.toLowerCase()}`}
                          </td>
                          <td className="py-1.5">
                            <div className="flex items-center justify-end gap-1">
                              <Input
                                className={`h-7 w-28 text-xs text-right ${dirty ? "ring-2 ring-amber-300/60" : ""}`}
                                type="number" min="0" step="0.01"
                                placeholder="Sin costo"
                                value={cell}
                                onChange={(e) => setDraft((prev) => ({ ...prev, [member.productId]: e.target.value }))}
                                title={member.isCanonical ? "Costo global — aplica a todas las sucursales" : `Costo en ${member.saleUnit.toLowerCase()} — se convierte automáticamente al canónico`}
                              />
                              <button type="button" title="Guardar costo global"
                                className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white transition-all disabled:opacity-50 ${savingKey === key ? "bg-gray-400" : "bg-emerald-600 hover:bg-emerald-700 shadow-sm"}`}
                                disabled={savingKey === key}
                                onClick={() => saveCost(member, cell)}
                              >
                                {savingKey === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                              </button>
                            </div>
                          </td>
                          <td className="r text-xs tabular-nums">{money(member.standardSalePrice)}</td>
                          <td className="r"><Badge variant={marginBadgeVariant(member.marginPercent)}>{member.marginPercent === null ? "N/D" : `${member.marginPercent.toFixed(1)}%`}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
