import type { ReactNode } from "react";
import type { Metadata } from "next";

/**
 * Minimal root layout for the API-only backend project.
 * The backend never renders real UI — this layout exists only because
 * Next.js requires it. All routes under `/api/*` and `/health` return JSON.
 */
export const metadata: Metadata = {
  title: "H.A.M.M.E.R. API",
  description: "Backend API for H.A.M.M.E.R. POS/ERP",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
