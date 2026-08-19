import { redirect } from "next/navigation";

/**
 * Compatibilidad: el Motor 1 de reposición (umbrales estáticos) se fusionó en
 * "Reposición Inteligente v2". Esta ruta queda como redirect permanente para
 * no romper enlaces guardados (incluido el link histórico del Brain).
 */
export default function MasterReorderRedirectPage() {
  redirect("/app/master/replenishment");
}
