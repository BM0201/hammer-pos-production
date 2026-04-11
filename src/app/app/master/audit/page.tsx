import { requireMaster } from "@/modules/auth/guards";
import { AuditLogViewer } from "@/components/audit/audit-log-viewer";

export default async function MasterAuditPage() {
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
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">Bitácora Global</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Trazabilidad operativa multi-sucursal para control master</p>
          </div>
        </div>
      </div>
      <AuditLogViewer />
    </section>
  );
}
