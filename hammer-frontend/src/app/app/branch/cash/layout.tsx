import type { ReactNode } from "react";
import { IdleLock } from "@/components/security/idle-lock";

// Vistas de caja: terminal compartida entre turnos → bloqueo por
// inactividad a los 5 minutos.
export default function CashLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <IdleLock timeoutMinutes={5} />
    </>
  );
}
