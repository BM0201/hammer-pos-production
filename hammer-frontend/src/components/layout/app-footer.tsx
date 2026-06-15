export function AppFooter() {
  return (
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-2.5 lg:px-8">
      <div className="flex flex-col gap-1 text-[0.625rem] text-[var(--color-text-soft)] sm:flex-row sm:items-center sm:justify-between">
        <span className="font-medium tracking-wide">H.A.M.M.E.R. V2 &nbsp;·&nbsp; POS / ERP Multi-Sucursal</span>
        <span className="flex items-center gap-2">
          <span className="hm-pulse-dot" />
          <span className="font-medium">Operacion segura</span>
        </span>
      </div>
    </footer>
  );
}
