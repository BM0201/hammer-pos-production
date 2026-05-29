type LoadingStateProps = {
  message?: string;
};

export function LoadingState({ message = "Cargando..." }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-12 shadow-sm">
      <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-info-600)]" />
      <p className="text-sm font-medium text-[var(--color-text-muted)]">{message}</p>
    </div>
  );
}
