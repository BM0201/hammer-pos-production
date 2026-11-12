import type { ReactNode } from "react";
import { IdleLock } from "@/components/security/idle-lock";

// Cola de cobros del cajero: terminal compartida entre turnos → bloqueo por
// inactividad (tiempo en IdleLock).
export default function CashierLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <IdleLock />
    </>
  );
}
