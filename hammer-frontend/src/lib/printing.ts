import { apiFetch } from "@/lib/client/api";

export function printHtml(html: string) {
  const win = window.open("", "_blank", "width=420,height=720");
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 150);
  return true;
}

export async function openPrintableDocument(url: string) {
  const response = await apiFetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? payload?.message ?? "No se pudo generar el documento.");
  }
  const data = payload.data ?? payload;
  if (typeof data.html === "string") {
    printHtml(data.html);
    return data;
  }
  if (typeof data.text === "string") {
    printHtml(`<pre>${data.text}</pre>`);
    return data;
  }
  throw new Error("El documento no contiene HTML imprimible.");
}

export async function recordPrintAudit(input: {
  branchId?: string;
  saleOrderId?: string;
  entityType: string;
  entityId: string;
  documentType: string;
  isReprint?: boolean;
  reason?: string;
}) {
  await apiFetch("/api/printing/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => undefined);
}
