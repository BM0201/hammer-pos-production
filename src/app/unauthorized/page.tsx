"use client";

import Link from "next/link";
import { LockKeyhole, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function UnauthorizedPage() {
  return (
    <main className="min-h-screen grid place-items-center p-6 bg-[var(--color-page-bg)]">
      <div className="text-center animate-fade-in-up max-w-sm">
        <div className="mx-auto w-20 h-20 rounded-2xl bg-[var(--color-warning-50)] flex items-center justify-center mb-5">
          <LockKeyhole className="h-10 w-10 text-[var(--color-warning-500)]" />
        </div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Sesión Requerida</h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)] leading-relaxed">
          Debes iniciar sesión para acceder a esta sección del sistema.
        </p>
        <Link href="/login" className="mt-6 inline-flex">
          <Button variant="primary" icon={<LogIn className="h-4 w-4" />}>
            Ir a Login
          </Button>
        </Link>
      </div>
    </main>
  );
}
