/**
 * HMAC de lote para importación Excel.
 *
 * Previene que el cliente modifique items entre la fase de preview y execute.
 * El servidor firma el listado en preview → el cliente devuelve el token en execute
 * → el servidor recomputa y compara antes de procesar.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { InventoryImportPreviewItem } from "./service";

type SignableItem = Pick<
  InventoryImportPreviewItem,
  "rowNumber" | "sku" | "targetBranchId" | "quantity" | "unitCost" | "action" | "status"
>;

function getSecret(): string {
  const s = process.env.AUTH_SESSION_SECRET;
  if (!s) throw new Error("INTERNAL_ERROR: AUTH_SESSION_SECRET no configurado");
  return s;
}

function canonicalize(items: SignableItem[]): string {
  return JSON.stringify(
    [...items]
      .sort((a, b) => a.rowNumber - b.rowNumber)
      .map((i) => ({
        n: i.rowNumber,
        s: i.sku,
        b: i.targetBranchId,
        q: i.quantity,
        c: i.unitCost,
        a: i.action,
        st: i.status,
      })),
  );
}

/** Genera un token HMAC-SHA256 que cubre los campos sensibles de los items. */
export function signImportBatch(items: InventoryImportPreviewItem[]): string {
  return createHmac("sha256", getSecret())
    .update("import-batch:" + canonicalize(items))
    .digest("hex");
}

/** Verifica el token. Lanza FORBIDDEN si no coincide. */
export function verifyImportBatch(
  items: InventoryImportPreviewItem[],
  token: string,
): void {
  const expected = signImportBatch(items);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf   = Buffer.from(token, "hex");

  if (
    expectedBuf.length !== actualBuf.length ||
    !timingSafeEqual(expectedBuf, actualBuf)
  ) {
    throw new Error("FORBIDDEN: el lote de importación fue modificado tras el preview");
  }
}
