// IndexedDB helper for Hammer POS offline mode.
// No external dependencies — uses the native IDB API.

const DB_NAME = "hammer-pos";
const DB_VERSION = 1;

let _db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("catalog")) {
        db.createObjectStore("catalog"); // keyed by branchId
      }
      if (!db.objectStoreNames.contains("context")) {
        db.createObjectStore("context"); // keyed by branchId
      }
      if (!db.objectStoreNames.contains("queue")) {
        db.createObjectStore("queue", { keyPath: "offlineId" });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(req.result); };
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readwrite").objectStore(store).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbDel(store: string, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readwrite").objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

// ─── Catalog snapshot ──────────────────────────────────────────────────────────

export type CachedProduct = {
  id: string;
  sku: string;
  name: string;
  barcode?: string | null;
  categoryName?: string | null;
  effectivePrice: number;
  unit: string;
  availableSaleStock: number | null;
};

export async function saveCatalog(branchId: string, products: CachedProduct[]): Promise<void> {
  await idbPut("catalog", branchId, { products, savedAt: new Date().toISOString() });
}

export async function getCatalog(branchId: string): Promise<CachedProduct[]> {
  const entry = await idbGet<{ products: CachedProduct[]; savedAt: string }>("catalog", branchId);
  return entry?.products ?? [];
}

// ─── POS context snapshot ──────────────────────────────────────────────────────

export type CachedPosContext = {
  branchId: string;
  cashSessionId: string;
  operatorUserId: string;
  savedAt: string;
};

export async function savePosContext(ctx: CachedPosContext): Promise<void> {
  await idbPut("context", ctx.branchId, ctx);
}

export async function getPosContext(branchId: string): Promise<CachedPosContext | null> {
  return idbGet<CachedPosContext>("context", branchId);
}

// ─── Offline sales queue ───────────────────────────────────────────────────────

export type OfflineSaleLine = {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  lineSubtotal: number;
};

export type OfflineSale = {
  offlineId: string;
  branchId: string;
  cashSessionId: string;
  operatorUserId: string;
  lines: OfflineSaleLine[];
  grandTotal: number;
  notes?: string;
  createdAt: string;
  status: "PENDING_SYNC" | "SYNCED" | "SYNC_FAILED";
  syncError?: string;
  serverOrderId?: string;
  serverOrderNumber?: string;
};

export async function enqueueOfflineSale(sale: OfflineSale): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction("queue", "readwrite").objectStore("queue").add(sale);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getOfflineQueue(): Promise<OfflineSale[]> {
  return idbGetAll<OfflineSale>("queue");
}

export async function updateOfflineSale(sale: OfflineSale): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction("queue", "readwrite").objectStore("queue").put(sale);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function removeFromQueue(offlineId: string): Promise<void> {
  await idbDel("queue", offlineId);
}

export async function getPendingCount(): Promise<number> {
  const queue = await getOfflineQueue();
  return queue.filter(s => s.status === "PENDING_SYNC" || s.status === "SYNC_FAILED").length;
}
