import test from 'node:test';
import assert from 'node:assert/strict';
import { can, CAPABILITIES } from '../../src/modules/rbac/policies';
import { canPostMovement } from '../../src/modules/inventory/policy';

test('branch admin is supervisory (cannot submit payment or post manual inventory)', () => {
  assert.equal(can('BRANCH_ADMIN', CAPABILITIES.SALES_SUBMIT_PAYMENT), false);
  assert.equal(can('BRANCH_ADMIN', CAPABILITIES.APPROVAL_REQUEST_REVIEW), true);
  assert.equal(canPostMovement('BRANCH_ADMIN', 'ADJUSTMENT_IN'), false);
});

test('warehouse can post inventory movements through dedicated capability', () => {
  assert.equal(can('WAREHOUSE', CAPABILITIES.INVENTORY_MOVEMENT_POST), true);
  assert.equal(canPostMovement('WAREHOUSE', 'TRANSFER_OUT'), true);
});
