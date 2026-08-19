/**
 * prompt-correccion-ubicacion-formula-datos-prueba.md C4/§2.4 — "si el
 * ambiente donde se tomaron las capturas es de desarrollo compartido, la
 * interfaz debe decir 'Ambiente de prueba' de forma visible... para que
 * nunca sea indistinguible de producción". Esto importa más que el resto de
 * ese documento: la plata es el dato donde un ambiente mal señalizado hace
 * más daño.
 *
 * Fail-safe a mostrar: el banner aparece SALVO que NEXT_PUBLIC_APP_ENV esté
 * puesto exactamente en "production". Un preview de Vercel, un ambiente de
 * desarrollo, o un despliegue nuevo donde nadie configuró la variable
 * todavía, todos muestran el banner por defecto — el error seguro acá es
 * "avisar de más", nunca "avisar de menos". El deploy real de producción
 * necesita esta variable configurada explícitamente para que el banner
 * desaparezca.
 *
 * Server component (no "use client"): NEXT_PUBLIC_* se resuelve en build
 * time, no hace falta re-evaluarlo en el navegador.
 */
export function TestEnvironmentBanner() {
  const isConfirmedProduction = process.env.NEXT_PUBLIC_APP_ENV === "production";
  if (isConfirmedProduction) return null;

  return (
    <div
      role="alert"
      className="sticky top-0 z-[300] flex items-center justify-center gap-2 px-3 py-1 text-center text-xs font-semibold text-white"
      style={{ background: "repeating-linear-gradient(45deg, #b45309, #b45309 10px, #92400e 10px, #92400e 20px)" }}
    >
      ⚠ AMBIENTE DE PRUEBA — los datos que ves acá (incluida cualquier cifra de tesorería) pueden no ser reales
    </div>
  );
}
