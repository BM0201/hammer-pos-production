/**
 * Safety-net tests for BranchPos.
 *
 * Goal: detect regressions DURING the incremental refactor — not an exhaustive
 * unit test suite.  Two critical user flows are covered:
 *   1. QUEUE  — search → add product → change quantity → enviar a caja
 *   2. DIRECT — add product → cobrar aquí (venta directa)
 *
 * These tests run against the component AS-IS.  They must pass at every
 * refactor step; if one breaks, stop and surface the failure.
 *
 * Mocking strategy
 * ─────────────────
 * • global.fetch → all GET-only API calls (reloadOrder, loadTopSelling,
 *   loadProducts, loadPosContext, fetchStockForProduct).
 * • @/lib/client/api#apiFetch → all mutating calls + realtime summary + print
 *   settings (apiFetch handles CSRF internally; mocking at module level avoids
 *   CSRF machinery in tests).
 * • useOperationalPolling → no-op (prevents polling side-effects in tests).
 * • react-hot-toast, @/lib/printing, PrintModal → stubs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Module-level mocks (hoisted by vitest before imports) ─────────────────

vi.mock("@/lib/client/api", () => ({
  apiFetch: vi.fn(),
  unwrapApiData: (payload: unknown) => {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "ok" in payload &&
      (payload as Record<string, unknown>).ok === true &&
      "data" in payload
    ) {
      return (payload as Record<string, unknown>).data;
    }
    return payload;
  },
}));

vi.mock("@/lib/realtime/use-operational-polling", () => ({
  useOperationalPolling: vi.fn(),
}));

vi.mock("@/lib/printing", () => ({
  openPrintableDocument: vi.fn().mockResolvedValue(undefined),
  recordPrintAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/print/print-modal", () => ({
  PrintModal: () => null,
}));

// ── Import component AFTER mocks ──────────────────────────────────────────

import { BranchPos } from "../branch-pos";
import { apiFetch } from "@/lib/client/api";

// ── Response helpers ──────────────────────────────────────────────────────

function okJson(data: unknown) {
  return {
    ok: true as const,
    status: 200,
    json: () => Promise.resolve(data),
    clone() { return this; },
  } as unknown as Response;
}

function errJson(data: unknown, status = 422) {
  return {
    ok: false as const,
    status,
    json: () => Promise.resolve(data),
    clone() { return this; },
  } as unknown as Response;
}

// ── Fixtures ──────────────────────────────────────────────────────────────

const BRANCH_ID = "br-test-1";

const PRODUCT_1 = {
  id: "prod-1",
  sku: "SKU001",
  barcode: null as string | null,
  name: "Aceite Vegetal 1L",
  standardSalePrice: "45.00",
  unit: "UND",
  availableSaleStock: 15,
};

const EMPTY_DRAFT = {
  id: "ord-1",
  orderNumber: "ORD-0001",
  status: "DRAFT",
  grandTotal: "0.00",
  subtotal: "0.00",
  discountTotal: "0.00",
  taxTotal: "0.00",
  lines: [] as Line[],
};

type Line = {
  id: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  lineSubtotal: string;
  product: { name: string; sku: string };
};

const LINE_1: Line = {
  id: "line-1",
  productId: "prod-1",
  quantity: "1",
  unitPrice: "45.00",
  discountAmount: "0.00",
  lineSubtotal: "45.00",
  product: { name: "Aceite Vegetal 1L", sku: "SKU001" },
};

const DRAFT_WITH_LINE = {
  ...EMPTY_DRAFT,
  grandTotal: "45.00",
  subtotal: "45.00",
  lines: [LINE_1],
};

const LINE_1_QTY2: Line = { ...LINE_1, quantity: "2", lineSubtotal: "90.00" };
const DRAFT_QTY2 = { ...DRAFT_WITH_LINE, grandTotal: "90.00", subtotal: "90.00", lines: [LINE_1_QTY2] };

const HYBRID_CONTEXT = {
  data: {
    workflow: {
      enableCashier: true,
      enableDispatch: true,
      paymentWorkflowMode: "HYBRID",
      dispatchWorkflowMode: "ENABLED",
    },
    permissions: { canSendToCashier: true, canCollectHere: true, canUseCashSession: true },
    assignedSessions: [{ id: "sess-1" }],
  },
};

const DIRECT_ONLY_CONTEXT = {
  data: {
    ...HYBRID_CONTEXT.data,
    workflow: {
      ...HYBRID_CONTEXT.data.workflow,
      paymentWorkflowMode: "DIRECT_ONLY",
    },
    permissions: { canSendToCashier: false, canCollectHere: true, canUseCashSession: true },
  },
};

// ── fetch mock builder ────────────────────────────────────────────────────
//
// ordersQueue: each call to /api/sales/orders returns the next item in order
// (last item is repeated once the queue is exhausted).

function buildFetchMock(opts: {
  ordersQueue: (typeof EMPTY_DRAFT)[];
  context?: typeof HYBRID_CONTEXT;
  topProducts?: typeof PRODUCT_1[];
  searchProducts?: typeof PRODUCT_1[];
}) {
  const {
    ordersQueue,
    context = HYBRID_CONTEXT,
    topProducts = [],
    searchProducts = [PRODUCT_1],
  } = opts;
  let orderIdx = 0;

  return vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);

    if (url.includes("/api/pos/v2/context")) return okJson(context);

    if (url.includes("/api/sales/orders")) {
      const order = ordersQueue[Math.min(orderIdx, ordersQueue.length - 1)];
      orderIdx++;
      return okJson({ data: order });
    }

    if (url.includes("/api/catalog/products")) {
      const isTopSelling = url.includes("topSelling=true");
      return okJson({ data: isTopSelling ? topProducts : searchProducts });
    }

    if (url.includes("/api/inventory/balances")) {
      return okJson({
        data: [{ productId: "prod-1", quantityOnHand: "15", availableSaleStock: 15 }],
      });
    }

    // Any unhandled URL: return empty ok — prevents test noise.
    return okJson({});
  });
}

// ── Test suite ────────────────────────────────────────────────────────────

describe("BranchPos — safety net", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ── helpers shared across tests ─────────────────────────────────────────

  /** Renders the component and waits for the initial loading spinner to clear. */
  async function renderAndLoad(fetchMock: ReturnType<typeof vi.fn>) {
    global.fetch = fetchMock as unknown as typeof globalThis.fetch;
    // apiFetch is used for mutations + print-settings; default to OK response.
    vi.mocked(apiFetch).mockResolvedValue(okJson({}));

    render(<BranchPos branchId={BRANCH_ID} />);

    // Loading spinner visible first
    expect(screen.getByTestId("pos-root-loading")).toBeInTheDocument();

    // Wait for initial load to finish (reloadOrder sets isInitialLoading=false)
    await screen.findByTestId("pos-root");

    return {
      searchInput: screen.getByTestId("pos-search-input"),
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // QUEUE FLOW
  // ──────────────────────────────────────────────────────────────────────

  describe("QUEUE flow — search → add product → change qty → enviar a caja", () => {
    it("renders the main POS structure with expected data-testids after load", async () => {
      const fetchMock = buildFetchMock({ ordersQueue: [EMPTY_DRAFT] });
      await renderAndLoad(fetchMock);

      // Static landmarks
      expect(screen.getByTestId("pos-root")).toBeInTheDocument();
      expect(screen.getByTestId("pos-catalog-zone")).toBeInTheDocument();
      expect(screen.getByTestId("pos-search-input")).toBeInTheDocument();
      expect(screen.getByTestId("pos-catalog-viewport")).toBeInTheDocument();
      expect(screen.getByTestId("pos-ticket-zone")).toBeInTheDocument();
      expect(screen.getByTestId("pos-ticket-lines")).toBeInTheDocument();
      expect(screen.getByTestId("pos-payment-zone")).toBeInTheDocument();
      expect(screen.getByTestId("pos-total")).toBeInTheDocument();

      // QUEUE button visible, disabled (no lines yet)
      const sendBtn = screen.getByTestId("pos-send-to-payment");
      expect(sendBtn).toBeInTheDocument();
      expect(sendBtn).toBeDisabled();
    });

    it("shows search results when the user types in the search box", async () => {
      const fetchMock = buildFetchMock({
        ordersQueue: [EMPTY_DRAFT],
        searchProducts: [PRODUCT_1],
      });
      const { searchInput } = await renderAndLoad(fetchMock);
      const user = userEvent.setup();

      await user.type(searchInput, "Aceite");

      // After debounce (250 ms) + fetch, product button appears
      await waitFor(
        () => expect(screen.getByTestId(`pos-product-${PRODUCT_1.id}`)).toBeInTheDocument(),
        { timeout: 2000 },
      );

      const btn = screen.getByTestId(`pos-product-${PRODUCT_1.id}`);
      expect(btn).toHaveTextContent("Aceite Vegetal 1L");
    });

    it("adds a product to the ticket when clicked and shows the line", async () => {
      // ordersQueue: [empty → reload after add → draft with line]
      const fetchMock = buildFetchMock({
        ordersQueue: [EMPTY_DRAFT, DRAFT_WITH_LINE],
        searchProducts: [PRODUCT_1],
      });
      const { searchInput } = await renderAndLoad(fetchMock);
      const user = userEvent.setup();

      // apiFetch POST /lines → ok
      vi.mocked(apiFetch).mockResolvedValue(okJson({}));

      await user.type(searchInput, "Aceite");
      await screen.findByTestId(`pos-product-${PRODUCT_1.id}`, {}, { timeout: 2000 });

      await user.click(screen.getByTestId(`pos-product-${PRODUCT_1.id}`));

      // Ticket line appears with the qty input
      const qtyInput = await screen.findByTestId(`pos-line-qty-${LINE_1.id}`, {}, { timeout: 2000 });
      expect(qtyInput).toHaveValue("1");

      // Total updates
      const total = screen.getByTestId("pos-total");
      expect(total).toHaveTextContent("45.00");

      // "Enviar a caja" button is now enabled
      await waitFor(() => expect(screen.getByTestId("pos-send-to-payment")).not.toBeDisabled());
    });

    it("applies a quantity change committed via the Aplicar button", async () => {
      // ordersQueue: [empty, line×1, empty(initial load for context), line×2 (after qty update)]
      // Actual call sequence: initial(empty) → add(line×1) → qty_update(line×2)
      const fetchMock = buildFetchMock({
        ordersQueue: [EMPTY_DRAFT, DRAFT_WITH_LINE, DRAFT_QTY2],
        searchProducts: [PRODUCT_1],
      });
      const { searchInput } = await renderAndLoad(fetchMock);
      const user = userEvent.setup();

      vi.mocked(apiFetch).mockResolvedValue(okJson({}));

      // Add product
      await user.type(searchInput, "Aceite");
      await screen.findByTestId(`pos-product-${PRODUCT_1.id}`, {}, { timeout: 2000 });
      await user.click(screen.getByTestId(`pos-product-${PRODUCT_1.id}`));
      await screen.findByTestId(`pos-line-qty-${LINE_1.id}`, {}, { timeout: 2000 });

      // Change qty to 2
      const qtyInput = screen.getByTestId(`pos-line-qty-${LINE_1.id}`);
      await user.clear(qtyInput);
      await user.type(qtyInput, "2");

      // Click Aplicar
      await user.click(screen.getByTestId(`pos-line-apply-${LINE_1.id}`));

      // apiFetch should have been called with PATCH for the line
      await waitFor(() => {
        const calls = vi.mocked(apiFetch).mock.calls;
        const patchCall = calls.find(
          ([url, opts]) =>
            String(url).includes(`/lines/${LINE_1.id}`) &&
            (opts as RequestInit | undefined)?.method === "PATCH",
        );
        expect(patchCall).toBeDefined();
      });

      // Updated total in DOM (component reloaded order with qty=2)
      await waitFor(() =>
        expect(screen.getByTestId("pos-total")).toHaveTextContent("90.00"),
      );
    });

    it("sends order to cashier and shows the success notice", async () => {
      const fetchMock = buildFetchMock({
        ordersQueue: [EMPTY_DRAFT, DRAFT_WITH_LINE, EMPTY_DRAFT],
        searchProducts: [PRODUCT_1],
      });
      const { searchInput } = await renderAndLoad(fetchMock);
      const user = userEvent.setup();

      vi.mocked(apiFetch).mockResolvedValue(okJson({}));

      // Add product
      await user.type(searchInput, "Aceite");
      await screen.findByTestId(`pos-product-${PRODUCT_1.id}`, {}, { timeout: 2000 });
      await user.click(screen.getByTestId(`pos-product-${PRODUCT_1.id}`));
      await screen.findByTestId("pos-send-to-payment", {}, { timeout: 2000 });
      await waitFor(() => expect(screen.getByTestId("pos-send-to-payment")).not.toBeDisabled());

      // Send to cashier
      await user.click(screen.getByTestId("pos-send-to-payment"));

      // apiFetch called with POST /submit
      await waitFor(() => {
        const submitCall = vi.mocked(apiFetch).mock.calls.find(
          ([url, opts]) =>
            String(url).includes("/submit") &&
            (opts as RequestInit | undefined)?.method === "POST",
        );
        expect(submitCall).toBeDefined();
      });

      // Success notice visible
      await screen.findByTestId("pos-notice", {}, { timeout: 3000 });
      expect(screen.getByTestId("pos-notice")).toHaveTextContent(/caja/i);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // DIRECT FLOW
  // ──────────────────────────────────────────────────────────────────────

  describe("DIRECT flow — add product → cobrar aquí", () => {
    it("shows the cobrar-aquí button when canCollectHere with active session", async () => {
      const fetchMock = buildFetchMock({
        ordersQueue: [EMPTY_DRAFT],
        context: DIRECT_ONLY_CONTEXT,
        searchProducts: [PRODUCT_1],
      });
      await renderAndLoad(fetchMock);

      // Direct collect button present
      await waitFor(() => expect(screen.getByTestId("pos-direct-collect")).toBeInTheDocument());

      // "Enviar a caja" NOT present in DIRECT_ONLY mode
      expect(screen.queryByTestId("pos-send-to-payment")).not.toBeInTheDocument();
    });

    it("completes a direct sale and shows the success notice", async () => {
      const fetchMock = buildFetchMock({
        ordersQueue: [EMPTY_DRAFT, DRAFT_WITH_LINE, EMPTY_DRAFT],
        context: DIRECT_ONLY_CONTEXT,
        searchProducts: [PRODUCT_1],
      });
      const { searchInput } = await renderAndLoad(fetchMock);
      const user = userEvent.setup();

      vi.mocked(apiFetch).mockResolvedValue(okJson({}));

      // Add product
      await user.type(searchInput, "Aceite");
      await screen.findByTestId(`pos-product-${PRODUCT_1.id}`, {}, { timeout: 2000 });
      await user.click(screen.getByTestId(`pos-product-${PRODUCT_1.id}`));

      // Wait for line + button enabled
      await screen.findByTestId(`pos-line-qty-${LINE_1.id}`, {}, { timeout: 2000 });
      await waitFor(() => expect(screen.getByTestId("pos-direct-collect")).not.toBeDisabled());

      // Click cobrar aquí
      await user.click(screen.getByTestId("pos-direct-collect"));

      // apiFetch called with POST /direct-sale
      await waitFor(() => {
        const directCall = vi.mocked(apiFetch).mock.calls.find(
          ([url, opts]) =>
            String(url).includes("/direct-sale") &&
            (opts as RequestInit | undefined)?.method === "POST",
        );
        expect(directCall).toBeDefined();
      });

      // Success notice visible
      await screen.findByTestId("pos-notice", {}, { timeout: 3000 });
      expect(screen.getByTestId("pos-notice")).toHaveTextContent(/complet|caja/i);
    });

    it("shows error notice when direct-sale API fails", async () => {
      const fetchMock = buildFetchMock({
        ordersQueue: [EMPTY_DRAFT, DRAFT_WITH_LINE],
        context: DIRECT_ONLY_CONTEXT,
        searchProducts: [PRODUCT_1],
      });
      const { searchInput } = await renderAndLoad(fetchMock);
      const user = userEvent.setup();

      // Print settings → ok; POST /lines → ok; POST /direct-sale → error
      vi.mocked(apiFetch)
        .mockResolvedValueOnce(okJson({}))  // print settings
        .mockResolvedValueOnce(okJson({}))  // POST /lines
        .mockResolvedValueOnce(errJson({ message: "NO_ACTIVE_CASH_SESSION" }));

      // Add product
      await user.type(searchInput, "Aceite");
      await screen.findByTestId(`pos-product-${PRODUCT_1.id}`, {}, { timeout: 2000 });
      await user.click(screen.getByTestId(`pos-product-${PRODUCT_1.id}`));
      await screen.findByTestId(`pos-line-qty-${LINE_1.id}`, {}, { timeout: 2000 });
      await waitFor(() => expect(screen.getByTestId("pos-direct-collect")).not.toBeDisabled());

      await user.click(screen.getByTestId("pos-direct-collect"));

      // Error notice visible
      await screen.findByTestId("pos-notice", {}, { timeout: 3000 });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // TRANSPORT
  // ──────────────────────────────────────────────────────────────────────

  describe("transport toggle", () => {
    it("transport toggle is visible and shows amount input when checked", async () => {
      const fetchMock = buildFetchMock({ ordersQueue: [EMPTY_DRAFT] });
      await renderAndLoad(fetchMock);
      const user = userEvent.setup();

      const toggle = screen.getByTestId("pos-transport-toggle");
      expect(toggle).toBeInTheDocument();

      // Amount input hidden initially
      expect(screen.queryByTestId("pos-transport-amount")).not.toBeInTheDocument();

      // Check the toggle
      const checkbox = within(toggle).getByRole("checkbox");
      await user.click(checkbox);

      // Amount input now visible
      expect(screen.getByTestId("pos-transport-amount")).toBeInTheDocument();
    });

    it("shows validation error when transport is enabled but amount is empty", async () => {
      const fetchMock = buildFetchMock({ ordersQueue: [EMPTY_DRAFT, DRAFT_WITH_LINE, EMPTY_DRAFT] });
      const { searchInput } = await renderAndLoad(fetchMock);
      const user = userEvent.setup();

      vi.mocked(apiFetch).mockResolvedValue(okJson({}));

      // Add product so send-to-payment becomes enabled
      await user.type(searchInput, "Aceite");
      await screen.findByTestId(`pos-product-${PRODUCT_1.id}`, {}, { timeout: 2000 });
      await user.click(screen.getByTestId(`pos-product-${PRODUCT_1.id}`));
      await screen.findByTestId("pos-send-to-payment", {}, { timeout: 2000 });
      await waitFor(() => expect(screen.getByTestId("pos-send-to-payment")).not.toBeDisabled());

      // Enable transport
      const toggle = screen.getByTestId("pos-transport-toggle");
      await user.click(within(toggle).getByRole("checkbox"));

      // Leave amount empty and try to send
      await user.click(screen.getByTestId("pos-send-to-payment"));

      // submit button should be disabled (transport validation error)
      await waitFor(() => expect(screen.getByTestId("pos-send-to-payment")).toBeDisabled());
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // LINE REMOVAL
  // ──────────────────────────────────────────────────────────────────────

  describe("line removal", () => {
    it("removes a ticket line when the Quitar button is clicked", async () => {
      const fetchMock = buildFetchMock({
        ordersQueue: [EMPTY_DRAFT, DRAFT_WITH_LINE, EMPTY_DRAFT],
        searchProducts: [PRODUCT_1],
      });
      const { searchInput } = await renderAndLoad(fetchMock);
      const user = userEvent.setup();

      vi.mocked(apiFetch).mockResolvedValue(okJson({}));

      // Add product
      await user.type(searchInput, "Aceite");
      await screen.findByTestId(`pos-product-${PRODUCT_1.id}`, {}, { timeout: 2000 });
      await user.click(screen.getByTestId(`pos-product-${PRODUCT_1.id}`));
      await screen.findByTestId(`pos-line-remove-${LINE_1.id}`, {}, { timeout: 2000 });

      // Remove it
      await user.click(screen.getByTestId(`pos-line-remove-${LINE_1.id}`));

      // apiFetch called with DELETE
      await waitFor(() => {
        const deleteCall = vi.mocked(apiFetch).mock.calls.find(
          ([url, opts]) =>
            String(url).includes(`/lines/${LINE_1.id}`) &&
            (opts as RequestInit | undefined)?.method === "DELETE",
        );
        expect(deleteCall).toBeDefined();
      });
    });
  });
});
