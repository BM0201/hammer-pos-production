import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoSelfApproval } from '../../src/modules/approvals/service';

test('assertNoSelfApproval allows reviewer different from requester', () => {
  assert.doesNotThrow(() => assertNoSelfApproval('user-a', 'user-b'));
});

test('assertNoSelfApproval blocks self approval', () => {
  assert.throws(() => assertNoSelfApproval('user-a', 'user-a'), /APPROVAL_SELF_REVIEW_FORBIDDEN/);
});
