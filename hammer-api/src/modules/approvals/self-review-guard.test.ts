/**
 * Run: node --import tsx --test src/modules/approvals/self-review-guard.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertNoSelfApproval } from "@/modules/approvals/service";

describe("assertNoSelfApproval", () => {
  it("lanza APPROVAL_SELF_REVIEW_FORBIDDEN cuando el revisor es quien solicitó", () => {
    assert.throws(
      () => assertNoSelfApproval("user-1", "user-1"),
      /APPROVAL_SELF_REVIEW_FORBIDDEN/,
    );
  });

  it("no lanza error cuando el revisor es distinto al solicitante", () => {
    assert.doesNotThrow(() => assertNoSelfApproval("user-1", "user-2"));
  });
});
