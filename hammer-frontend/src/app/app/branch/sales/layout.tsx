import type { ReactNode } from "react";
import { IdleLock } from "@/components/security/idle-lock";

// Vistas de venta (POS): terminal compartida entre turnos → bloqueo por
// inactividad a los 5 minutos. Las vistas de administración no lo llevan.
export default function SalesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <IdleLock timeoutMinutes={5} />
    </>
  );
}
