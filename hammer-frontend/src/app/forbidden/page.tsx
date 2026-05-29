import Link from "next/link";
import { ShieldX, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ForbiddenPage() {
  return (
    <main className="min-h-screen grid place-items-center p-6 bg-[var(--color-page-bg)]">
      <div className="text-center animate-fade-in-up max-w-sm">
        <div className="mx-auto w-20 h-20 rounded-2xl bg-[var(--color-danger-50)] flex items-center justify-center mb-5">
          <ShieldX className="h-10 w-10 text-[var(--color-danger-500)]" />
        </div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Acceso Denegado</h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)] leading-relaxed">
          Tu rol no tiene los permisos necesarios para acceder a este recurso.
          Contacta a tu administrador si crees que esto es un error.
        </p>
        <Link href="/app" className="mt-6 inline-flex">
          <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>
            Regresar al inicio
          </Button>
        </Link>
      </div>
    </main>
  );
}
