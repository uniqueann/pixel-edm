import test from "node:test";
import assert from "node:assert/strict";
import {
  EDM_BILLING_SCOPE,
  isEdmBillingMetadata,
  parseEdmBillingMetadata,
} from "../src/lib/billing/metadata.ts";

test("EDM 账单 metadata 约定", () => {
  assert.equal(EDM_BILLING_SCOPE, "edm");
  assert.equal(
    isEdmBillingMetadata({
      productScope: "edm",
      workspaceId: "00000000-0000-0000-0000-000000000001",
      billedPlan: "pro",
    }),
    true,
  );
  assert.equal(
    isEdmBillingMetadata({
      productScope: "edm",
      workspaceId: "x",
      billedPlan: "pro",
    }),
    true,
  );
  assert.equal(isEdmBillingMetadata({ productScope: "contentup" }), false);
  const parsed = parseEdmBillingMetadata({
    userId: "u1",
    workspaceId: "w1",
    billedPlan: "team",
    productScope: "edm",
  });
  assert.equal(parsed.billedPlan, "team");
  assert.equal(parsed.workspaceId, "w1");
});
