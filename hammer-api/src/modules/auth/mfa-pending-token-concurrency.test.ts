import assert from "node:assert/strict";
import test from "node:test";
import { consumeMfaPendingToken } from "@/modules/auth/mfa-service";

/**
 * prompt-seguridad-basica.md Fase 3.2 — consumeMfaPendingToken hacía
 * findUnique()+delete({where:{id}}): dos submits concurrentes con el MISMO
 * pendingToken pasaban el chequeo de expiración y ambos intentaban borrar la
 * misma fila — el segundo encontraba la fila ya borrada y Prisma lanzaba
 * P2025 sin manejar (500 en vez del 401 normal de "token inválido"). Ahora
 * usa deleteMany (count=0 en vez de excepción). `db` inyectable (fake en
 * memoria) porque los delegados reales de PrismaClient no exponen sus
 * métodos como propiedades propias normales — t.mock.method no puede
 * reemplazarlos (Object.getOwnPropertyDescriptor ve `undefined`).
 */

function createFakeDb(row: { id: string; userId: string; expiresAt: Date } | null) {
  let deleted = false;
  return {
    mfaPendingToken: {
      findUnique: async () => (row ? { ...row } : null),
      deleteMany: async ({ where }: { where: { id: string } }) => {
        if (!row || where.id !== row.id || deleted) return { count: 0 };
        deleted = true;
        return { count: 1 };
      },
    },
  };
}

test("LA QUE IMPORTA — doble submit del mismo pendingToken: el segundo recibe null, no una excepcion sin manejar", async () => {
  const db = createFakeDb({ id: "pending-1", userId: "user-1", expiresAt: new Date(Date.now() + 60_000) });

  const [first, second] = await Promise.all([
    consumeMfaPendingToken("token-abc", db),
    consumeMfaPendingToken("token-abc", db),
  ]);

  const results = [first, second].sort();
  assert.deepEqual(results, [null, "user-1"], "uno de los dos consume el token; el otro recibe null, nunca una excepcion");
});

test("token expirado: devuelve null sin intentar borrar nada", async () => {
  let deleteManyCalls = 0;
  const db = {
    mfaPendingToken: {
      findUnique: async () => ({ id: "pending-2", userId: "user-2", expiresAt: new Date(Date.now() - 1000) }),
      deleteMany: async () => {
        deleteManyCalls += 1;
        return { count: 0 };
      },
    },
  };

  const result = await consumeMfaPendingToken("token-expired", db);
  assert.equal(result, null);
  assert.equal(deleteManyCalls, 0, "un token ya expirado no debe intentar el delete");
});

test("token inexistente: devuelve null", async () => {
  const db = createFakeDb(null);
  const result = await consumeMfaPendingToken("token-nunca-existio", db);
  assert.equal(result, null);
});
