import assert from "node:assert/strict";
import test from "node:test";
import { paginateAll } from "@/modules/brain/pagination";

type Row = { id: string };

function fakeSource(total: number, pageSize: number) {
  const all: Row[] = Array.from({ length: total }, (_, i) => ({ id: String(i + 1).padStart(4, "0") }));
  return async (cursor: string | null): Promise<Row[]> => {
    const startIdx = cursor ? all.findIndex((r) => r.id === cursor) + 1 : 0;
    return all.slice(startIdx, startIdx + pageSize);
  };
}

test("paginateAll — recorre todas las páginas cuando sobra tiempo", async () => {
  const fetchPage = fakeSource(1200, 500);
  const { rows, truncated } = await paginateAll(fetchPage, (r) => r.id, { pageSize: 500, deadlineAt: Date.now() + 5000 });
  assert.equal(rows.length, 1200, "1200 filas reales, no las primeras 500/1000 de un take fijo");
  assert.equal(truncated, false);
});

test("LA QUE IMPORTA — paginateAll se detiene y marca truncated si se acaba el tiempo a mitad de camino", async () => {
  let calls = 0;
  const fetchPage = async (cursor: string | null) => {
    calls += 1;
    const source = fakeSource(1200, 500);
    if (calls === 2) await new Promise((r) => setTimeout(r, 30)); // la 2da página "tarda" — cruza el deadline
    return source(cursor);
  };
  const { rows, truncated } = await paginateAll(fetchPage, (r) => r.id, { pageSize: 500, deadlineAt: Date.now() + 20 });
  assert.equal(truncated, true, "se acabó el tiempo antes de la 3ra página — debe marcarse truncado");
  assert.ok(rows.length < 1200, "no leyó todo, pero sí lo que alcanzó antes del corte");
});

test("paginateAll — con menos filas que una página, no trunca", async () => {
  const fetchPage = fakeSource(42, 500);
  const { rows, truncated } = await paginateAll(fetchPage, (r) => r.id, { pageSize: 500, deadlineAt: Date.now() + 5000 });
  assert.equal(rows.length, 42);
  assert.equal(truncated, false);
});

test("paginateAll — exactamente múltiplo del pageSize hace una página extra vacía para confirmar el fin", async () => {
  const fetchPage = fakeSource(500, 500);
  let pagesFetched = 0;
  const counted = async (cursor: string | null) => { pagesFetched += 1; return fetchPage(cursor); };
  const { rows, truncated } = await paginateAll(counted, (r) => r.id, { pageSize: 500, deadlineAt: Date.now() + 5000 });
  assert.equal(rows.length, 500);
  assert.equal(truncated, false);
  assert.equal(pagesFetched, 2, "500 filas con pageSize 500: una página llena + una vacía que confirma que no hay más");
});
