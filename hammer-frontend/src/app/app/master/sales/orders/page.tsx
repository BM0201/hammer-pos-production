"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { OrdersAdmin } from "@/components/sales/orders-admin";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

type Branch = { id: string; code: string; name: string };

function MasterSalesOrdersContent() {
  const searchParams = useSearchParams();
  const branchId = searchParams.get("branchId") ?? undefined;
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/branches")
      .then(async (r) => (r.ok ? r.json() : null))
      .then((raw) => {
        if (cancelled || !raw) return;
        const unwrapped = unwrapApiData(raw);
        const list: Branch[] = Array.isArray(unwrapped) ? unwrapped : [];
        setBranches(list);
      })
      .catch(() => {
        /* swallow */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div
            className="h-8 w-1 rounded-full"
            style={{
              background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))",
            }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Órdenes de Venta</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Supervise ventas, caja, despacho, transporte, facturación manual y auditoría de todas las sucursales.</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          className={`rounded-lg border px-3 py-1.5 font-medium transition-colors ${
            !branchId
              ? "bg-[var(--color-master-600)] text-white border-[var(--color-master-600)]"
              : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]"
          }`}
          href="/app/master/sales/orders"
        >
          Todas las sucursales
        </Link>
        {branches.map((branch) => (
          <Link
            key={branch.id}
            className={`rounded-lg border px-3 py-1.5 font-medium transition-colors ${
              branchId === branch.id
                ? "bg-[var(--color-master-600)] text-white border-[var(--color-master-600)]"
                : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]"
            }`}
            href={`/app/master/sales/orders?branchId=${branch.id}`}
          >
            {branch.code}
          </Link>
        ))}
      </div>

      <OrdersAdmin branchId={branchId} isMaster={true} />
    </section>
  );
}

export default function MasterSalesOrdersPage() {
  return (
    <Suspense fallback={null}>
      <MasterSalesOrdersContent />
    </Suspense>
  );
}
