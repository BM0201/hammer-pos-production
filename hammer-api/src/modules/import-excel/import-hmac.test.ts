import { test, before } from "node:test";
import assert from "node:assert/strict";
import { signImportBatch, verifyImportBatch } from "@/modules/import-excel/import-hmac";
import type { InventoryImportPreviewItem } from "@/modules/import-excel/service";

before(() => {
  process.env.AUTH_SESSION_SECRET = "test-secret-32-chars-minimum-abc";
});

const sampleItem: InventoryImportPreviewItem = {
  rowNumber: 1,
  sku: "CEM-001",
  name: "Cemento Portland",
  quantity: 100,
  unitCost: 85.5,
  targetBranchId: "branch-abc-123",
  targetBranchCode: "SUC-01",
  targetBranchName: "Sucursal Principal",
  productStatus: "EXISTING",
  action: "IMPORT_EXISTING",
  status: "READY",
  messages: [],
};

test("signImportBatch: genera token hex de 64 chars (SHA-256)", () => {
  const token = signImportBatch([sampleItem]);
  assert.ok(/^[0-9a-f]{64}$/.test(token), `token inválido: "${token}"`);
});

test("verifyImportBatch: verifica token correcto sin lanzar", () => {
  const items = [sampleItem];
  const token = signImportBatch(items);
  assert.doesNotThrow(() => verifyImportBatch(items, token));
});

test("verifyImportBatch: lanza FORBIDDEN si cantidad fue modificada", () => {
  const items = [sampleItem];
  const token = signImportBatch(items);
  const tampered = [{ ...sampleItem, quantity: 9999 }];
  assert.throws(() => verifyImportBatch(tampered, token), /FORBIDDEN/);
});

test("verifyImportBatch: lanza FORBIDDEN si costo unitario fue modificado", () => {
  const items = [sampleItem];
  const token = signImportBatch(items);
  const tampered = [{ ...sampleItem, unitCost: 0.01 }];
  assert.throws(() => verifyImportBatch(tampered, token), /FORBIDDEN/);
});

test("verifyImportBatch: lanza FORBIDDEN si branchId fue modificado", () => {
  const items = [sampleItem];
  const token = signImportBatch(items);
  const tampered = [{ ...sampleItem, targetBranchId: "attacker-branch" }];
  assert.throws(() => verifyImportBatch(tampered, token), /FORBIDDEN/);
});

test("verifyImportBatch: lanza FORBIDDEN si action fue modificado", () => {
  const items = [sampleItem];
  const token = signImportBatch(items);
  const tampered = [{ ...sampleItem, action: "CREATE_AND_IMPORT" as const }];
  assert.throws(() => verifyImportBatch(tampered, token), /FORBIDDEN/);
});

test("verifyImportBatch: lanza FORBIDDEN si status fue modificado de ERROR a READY", () => {
  const errorItem = { ...sampleItem, status: "ERROR" as const };
  const token = signImportBatch([errorItem]);
  const tampered = [{ ...errorItem, status: "READY" as const }];
  assert.throws(() => verifyImportBatch(tampered, token), /FORBIDDEN/);
});

test("verifyImportBatch: lanza FORBIDDEN si se agrega un ítem extra", () => {
  const items = [sampleItem];
  const token = signImportBatch(items);
  const extraItem: InventoryImportPreviewItem = {
    ...sampleItem,
    rowNumber: 2,
    sku: "ARN-002",
    quantity: 50,
  };
  assert.throws(() => verifyImportBatch([sampleItem, extraItem], token), /FORBIDDEN/);
});

test("verifyImportBatch: orden de items no importa (canonicaliza por rowNumber)", () => {
  const item2 = { ...sampleItem, rowNumber: 2, sku: "ARN-002" };
  const token = signImportBatch([sampleItem, item2]);
  assert.doesNotThrow(() => verifyImportBatch([item2, sampleItem], token));
});

test("verifyImportBatch: campos no-críticos (name, messages) no invalidan el token", () => {
  const items = [sampleItem];
  const token = signImportBatch(items);
  const withDifferentName = [{ ...sampleItem, name: "Cemento Portland 42.5N", messages: ["warning"] }];
  assert.doesNotThrow(() => verifyImportBatch(withDifferentName, token));
});
