export function AppFooter() {
  return (
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 lg:px-8">
      <div className="flex flex-col gap-1 text-[0.6875rem] text-[var(--color-text-soft)] sm:flex-row sm:items-center sm:justify-between">
        <span>H.A.M.M.E.R. V2 POS/ERP Multi-Sucursal</span>
        <span className="flex items-center gap-2">
          <span className="hm-status-dot bg-[var(--color-success-600)]" />
          Operacion segura
        </span>
      </div>
    </footer>
  );
}
