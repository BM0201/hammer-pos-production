import { requireMaster } from "@/modules/auth/guards";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";

export default async function AnalyticsPage() {
  await requireMaster();

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
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Analytics · Clasificación ABC-XYZ</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Análisis de rotación, clasificación de productos y pricing dinámico</p>
          </div>
        </div>
      </div>

      <div className="hm-alert hm-alert-info">
        <div>
          <strong>Clasificación ABC-XYZ:</strong> Clasifique productos por contribución al valor de ventas (ABC) y
          estabilidad de demanda (XYZ). Use los resultados para ajustar márgenes, optimizar inventario y generar precios dinámicos.
          <br /><strong>A</strong>=Alto valor (70-80%), <strong>B</strong>=Medio (15-25%), <strong>C</strong>=Bajo (5-10%).
          <strong> X</strong>=Estable, <strong>Y</strong>=Variable, <strong>Z</strong>=Irregular.
        </div>
      </div>

      <AnalyticsDashboard />
    </section>
  );
}
