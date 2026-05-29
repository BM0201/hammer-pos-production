"use client";

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (value instanceof Date) return value.toLocaleString("es-NI");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function entries(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>);
}

export function DecisionEvidence({ title = "Evidencia", value }: { title?: string; value: unknown }) {
  const rows = entries(value);

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
      {rows.length ? (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          {rows.slice(0, 16).map(([key, item]) => (
            <div key={key} className="grid gap-1 border-b border-[var(--color-border)] px-3 py-2 text-xs last:border-b-0 md:grid-cols-[180px_1fr]">
              <div className="font-semibold text-[var(--color-text-muted)]">{key}</div>
              <pre className="whitespace-pre-wrap break-words font-sans text-[var(--color-text)]">{renderValue(item)}</pre>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
          Sin evidencia estructurada.
        </div>
      )}
    </section>
  );
}
