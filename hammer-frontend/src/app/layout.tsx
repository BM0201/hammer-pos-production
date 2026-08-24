import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { ToastContainer } from "@/components/ui/toast";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "H.A.M.M.E.R. — POS / ERP",
  description: "Sistema multi-sucursal de punto de venta y gestión empresarial.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EDECEA" },
    { media: "(prefers-color-scheme: dark)", color: "#1A1917" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Nonce por request generado en middleware.ts — los scripts inline propios
  // lo necesitan para pasar la CSP sin 'unsafe-inline' en producción.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen" suppressHydrationWarning>
        {/* Runs before first paint to avoid FOUC on theme reload. Prefers the
            per-user key (hammer-theme-<userId>) over the shared global key —
            on a shared terminal the global key still carries the PREVIOUS
            user's theme until applyUserTheme runs (after the splash), so
            reading it first would flash the wrong theme for the new user. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var u=localStorage.getItem('hammer-theme-user');var t=u&&localStorage.getItem('hammer-theme-'+u);if(!t)t=localStorage.getItem('hammer-theme');if(!t)t=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';var d=document.documentElement;d.dataset.theme=t;d.style.colorScheme=t;}catch(e){}})();`,
          }}
        />
        {/* Register service worker for offline POS support.
            updateViaCache:"none" — el navegador NUNCA debe servir sw.js desde
            su propio caché HTTP al chequear si hay una versión nueva; sin
            esto, un despliegue nuevo podía tardar mucho (o nunca, en una
            sesión larga) en detectarse, dejando clientes viendo la app vieja
            aunque el servidor ya tuviera el código nuevo. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(function(reg){reg.update();}).catch(function(){});}`,
          }}
        />
        {children}
        <ToastContainer />
      </body>
    </html>
  );
}
