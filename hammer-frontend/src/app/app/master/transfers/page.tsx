import { redirect } from "next/navigation";

/**
 * Compatibilidad: esta página (recomendaciones + gestión de traslados +
 * configuración) se fusionó por completo en "Reposición Inteligente v2"
 * (/app/master/replenishment, pestaña Traslados). Redirect permanente para
 * no romper enlaces guardados.
 */
export default function MasterTransfersRedirectPage() {
  redirect("/app/master/replenishment");
}
