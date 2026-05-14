import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { ToastContainer } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "H.A.M.M.E.R. — POS / ERP",
  description: "Sistema multi-sucursal de punto de venta y gestión empresarial.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-screen" suppressHydrationWarning>
        {children}
        <ToastContainer />
      </body>
    </html>
  );
}
