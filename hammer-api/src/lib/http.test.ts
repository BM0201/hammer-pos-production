import assert from "node:assert/strict";
import test from "node:test";
import { toHttpErrorResponse } from "@/lib/http";

/**
 * BELOW_COST_NOT_ALLOWED sigue mapeando a 409 con el mensaje genérico — lo
 * usan 6 de los 7 llamadores de assertPriceNotBelowCost (edición conjunta de
 * producto, precio de sucursal, importación), donde SÍ es obvio cuál precio
 * está en juego porque el usuario lo está editando en el mismo cambio. El
 * séptimo (editar SOLO el costo de compra desde updateProduct) dejó de
 * lanzar esto — ver catalog/service.ts y el comentario ahí ("revisa todo
 * completo": standardSalePrice no tiene ningún editor para un producto ya
 * creado, así que bloquear sin salida era peor que avisar sin bloquear).
 */
async function jsonBody(response: Response) {
  return response.json();
}

test("BELOW_COST_NOT_ALLOWED: 409 con el mensaje genérico", async () => {
  const res = toHttpErrorResponse(new Error("BELOW_COST_NOT_ALLOWED"));
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error.code, "BELOW_COST_NOT_ALLOWED");
  assert.equal(body.error.message, "El precio no puede ser menor al costo. Corrige el costo y el precio juntos.");
});
