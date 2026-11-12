import type { ReactNode } from "react";
import { IdleLock } from "@/components/security/idle-lock";

// Vistas de venta (POS): terminal compartida entre turnos → bloqueo por
// inactividad (tiempo en IdleLock). Las vistas de administración no lo llevan.
export default function SalesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <IdleLock />
    </>
  );
}
