import { redirect } from "next/navigation";

/**
 * Compatibilidad: "Gastos Operativos & Precios" se unificó en "Finanzas & Contabilidad".
 * Esta ruta queda como redirect permanente para no romper enlaces guardados.
 */
export default function MasterExpensesRedirectPage() {
  redirect("/app/master/finance");
}
